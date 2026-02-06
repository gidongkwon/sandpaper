use super::bridge::{DebugActRequest, DebugRequestEnvelope, DebugRequestKind, DebugResponse};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::{SocketAddr, TcpListener, TcpStream};
use std::sync::mpsc::{self, Sender};
use std::thread::{self, JoinHandle};
use std::time::Duration;
use uuid::Uuid;

pub(crate) const DEBUG_FLAG_ENV: &str = "SANDPAPER_AGENT_DEBUG";
pub(crate) const DEBUG_ADDR_ENV: &str = "SANDPAPER_AGENT_DEBUG_ADDR";
pub(crate) const DEBUG_TOKEN_ENV: &str = "SANDPAPER_AGENT_DEBUG_TOKEN";

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct AgentDebugServerConfig {
    pub(crate) addr: SocketAddr,
    pub(crate) token: String,
    pub(crate) token_generated: bool,
}

impl AgentDebugServerConfig {
    pub(crate) fn from_env() -> Result<Option<Self>, String> {
        if !env_flag_enabled(DEBUG_FLAG_ENV) {
            return Ok(None);
        }

        let addr_raw = std::env::var(DEBUG_ADDR_ENV).unwrap_or_else(|_| "127.0.0.1:4967".into());
        let addr = addr_raw
            .parse::<SocketAddr>()
            .map_err(|err| format!("invalid {DEBUG_ADDR_ENV} value '{addr_raw}': {err}"))?;

        let token_raw = std::env::var(DEBUG_TOKEN_ENV).ok();
        let (token, token_generated) = match token_raw {
            Some(token) if !token.trim().is_empty() => (token.trim().to_string(), false),
            _ => (Uuid::new_v4().to_string(), true),
        };

        Ok(Some(Self {
            addr,
            token,
            token_generated,
        }))
    }
}

pub(crate) struct AgentDebugServerHandle {
    shutdown_tx: Sender<()>,
    thread: Option<JoinHandle<()>>,
}

impl Drop for AgentDebugServerHandle {
    fn drop(&mut self) {
        let _ = self.shutdown_tx.send(());
        if let Some(handle) = self.thread.take() {
            let _ = handle.join();
        }
    }
}

#[derive(Debug)]
struct ParsedRequest {
    method: String,
    path: String,
    headers: HashMap<String, String>,
    body: Vec<u8>,
}

enum RouteDecision {
    Immediate(DebugResponse),
    Bridge(DebugRequestKind),
}

pub(crate) fn start_server(
    config: AgentDebugServerConfig,
    request_tx: Sender<DebugRequestEnvelope>,
) -> Result<AgentDebugServerHandle, String> {
    let listener =
        TcpListener::bind(config.addr).map_err(|err| format!("bind {}: {err}", config.addr))?;
    listener
        .set_nonblocking(true)
        .map_err(|err| format!("set_nonblocking: {err}"))?;

    let (shutdown_tx, shutdown_rx) = mpsc::channel::<()>();
    let addr = listener
        .local_addr()
        .map_err(|err| format!("local_addr: {err}"))?;
    let token = config.token.clone();
    let token_for_thread = config.token.clone();

    let thread = thread::Builder::new()
        .name("sandpaper-agent-debug".to_string())
        .spawn(move || loop {
            if shutdown_rx.try_recv().is_ok() {
                break;
            }
            match listener.accept() {
                Ok((mut stream, _peer)) => {
                    let tx = request_tx.clone();
                    let thread_token = token_for_thread.clone();
                    thread::spawn(move || {
                        let response = match read_request(&mut stream)
                            .map(|req| route_request(&req, &thread_token))
                        {
                            Ok(RouteDecision::Immediate(response)) => response,
                            Ok(RouteDecision::Bridge(kind)) => {
                                let (response_tx, response_rx) = mpsc::channel();
                                if tx
                                    .send(DebugRequestEnvelope {
                                        kind,
                                        respond_to: response_tx,
                                    })
                                    .is_err()
                                {
                                    DebugResponse::error(
                                        503,
                                        "bridge_unavailable",
                                        "debug bridge unavailable",
                                    )
                                } else {
                                    match response_rx.recv_timeout(Duration::from_secs(5)) {
                                        Ok(response) => response,
                                        Err(_) => DebugResponse::error(
                                            504,
                                            "bridge_timeout",
                                            "debug bridge timed out",
                                        ),
                                    }
                                }
                            }
                            Err(err) => DebugResponse::error(400, "bad_request", &err),
                        };
                        let _ = write_response(&mut stream, &response);
                    });
                }
                Err(err) if err.kind() == std::io::ErrorKind::WouldBlock => {
                    thread::sleep(Duration::from_millis(25));
                }
                Err(err) => {
                    eprintln!("agent debug accept error: {err}");
                    thread::sleep(Duration::from_millis(100));
                }
            }
        })
        .map_err(|err| format!("spawn debug server thread: {err}"))?;

    let token_log = if config.token_generated {
        format!("{token} (generated)")
    } else {
        token.clone()
    };
    println!("sandpaper agent debug enabled on http://{addr} with bearer token: {token_log}");

    Ok(AgentDebugServerHandle {
        shutdown_tx,
        thread: Some(thread),
    })
}

fn env_flag_enabled(key: &str) -> bool {
    std::env::var(key)
        .map(|value| {
            matches!(
                value.trim().to_ascii_lowercase().as_str(),
                "1" | "true" | "yes" | "on"
            )
        })
        .unwrap_or(false)
}

fn read_request(stream: &mut TcpStream) -> Result<ParsedRequest, String> {
    stream
        .set_read_timeout(Some(Duration::from_millis(500)))
        .map_err(|err| format!("set read timeout: {err}"))?;

    let mut bytes = Vec::new();
    let mut chunk = [0_u8; 1024];

    loop {
        match stream.read(&mut chunk) {
            Ok(0) => break,
            Ok(count) => {
                bytes.extend_from_slice(&chunk[..count]);
                if bytes.len() > 2 * 1024 * 1024 {
                    return Err("request too large".to_string());
                }
            }
            Err(err)
                if err.kind() == std::io::ErrorKind::WouldBlock
                    || err.kind() == std::io::ErrorKind::TimedOut =>
            {
                break;
            }
            Err(err) => return Err(format!("read request: {err}")),
        }
    }

    parse_request_bytes(&bytes)
}

fn parse_request_bytes(bytes: &[u8]) -> Result<ParsedRequest, String> {
    let header_end = find_header_end(bytes).ok_or_else(|| "invalid HTTP request".to_string())?;
    let header_raw = &bytes[..header_end];
    let body = bytes[header_end + 4..].to_vec();

    let header_text = String::from_utf8(header_raw.to_vec())
        .map_err(|_| "request headers must be UTF-8".to_string())?;
    let mut lines = header_text.lines();
    let request_line = lines
        .next()
        .ok_or_else(|| "missing request line".to_string())?;

    let mut request_parts = request_line.split_whitespace();
    let method = request_parts
        .next()
        .ok_or_else(|| "missing HTTP method".to_string())?
        .to_string();
    let path = request_parts
        .next()
        .ok_or_else(|| "missing request path".to_string())?
        .to_string();
    let _version = request_parts
        .next()
        .ok_or_else(|| "missing HTTP version".to_string())?;

    let mut headers = HashMap::new();
    for line in lines {
        let mut parts = line.splitn(2, ':');
        let key = parts
            .next()
            .ok_or_else(|| "invalid header key".to_string())?
            .trim()
            .to_ascii_lowercase();
        let value = parts
            .next()
            .ok_or_else(|| "invalid header value".to_string())?
            .trim()
            .to_string();
        headers.insert(key, value);
    }

    if let Some(content_length) = headers.get("content-length") {
        let expected = content_length
            .parse::<usize>()
            .map_err(|_| "invalid content-length".to_string())?;
        if body.len() < expected {
            return Err("incomplete request body".to_string());
        }
        if body.len() > expected {
            return Ok(ParsedRequest {
                method,
                path,
                headers,
                body: body[..expected].to_vec(),
            });
        }
    }

    Ok(ParsedRequest {
        method,
        path,
        headers,
        body,
    })
}

fn find_header_end(bytes: &[u8]) -> Option<usize> {
    bytes.windows(4).position(|window| window == b"\r\n\r\n")
}

fn route_request(req: &ParsedRequest, token: &str) -> RouteDecision {
    if !is_authorized(req, token) {
        return RouteDecision::Immediate(DebugResponse::error(
            401,
            "unauthorized",
            "missing or invalid bearer token",
        ));
    }

    match (req.method.as_str(), req.path.as_str()) {
        ("GET", "/health") => RouteDecision::Immediate(DebugResponse::ok(json!({
            "ok": true,
            "version": env!("CARGO_PKG_VERSION"),
            "platform": std::env::consts::OS,
        }))),
        ("GET", "/v1/tree") => RouteDecision::Bridge(DebugRequestKind::Tree),
        ("GET", "/v1/snapshot") => RouteDecision::Bridge(DebugRequestKind::Snapshot),
        ("POST", "/v1/act") => match parse_act_request(&req.body) {
            Ok(act) => RouteDecision::Bridge(DebugRequestKind::Act(act)),
            Err(err) => RouteDecision::Immediate(DebugResponse::error(400, "invalid_act", &err)),
        },
        _ => RouteDecision::Immediate(DebugResponse::error(404, "not_found", "route not found")),
    }
}

fn parse_act_request(body: &[u8]) -> Result<DebugActRequest, String> {
    let value: Value =
        serde_json::from_slice(body).map_err(|_| "request body must be valid JSON".to_string())?;
    let element_id = value
        .get("element_id")
        .and_then(Value::as_str)
        .ok_or_else(|| "element_id must be a string".to_string())?
        .trim()
        .to_string();
    if element_id.is_empty() {
        return Err("element_id must not be empty".to_string());
    }
    let action = value
        .get("action")
        .and_then(Value::as_str)
        .ok_or_else(|| "action must be a string".to_string())?
        .trim()
        .to_string();
    if action.is_empty() {
        return Err("action must not be empty".to_string());
    }

    Ok(DebugActRequest {
        element_id,
        action,
        args: value.get("args").cloned(),
    })
}

fn is_authorized(req: &ParsedRequest, token: &str) -> bool {
    let expected = format!("Bearer {token}");
    req.headers
        .get("authorization")
        .is_some_and(|value| value == &expected)
}

fn write_response(stream: &mut TcpStream, response: &DebugResponse) -> Result<(), String> {
    let body = serde_json::to_vec(&response.body).map_err(|err| format!("encode JSON: {err}"))?;
    let status = response.status_code;
    let status_text = status_text(status);
    let headers = format!(
        "HTTP/1.1 {status} {status_text}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        body.len()
    );
    stream
        .write_all(headers.as_bytes())
        .map_err(|err| format!("write headers: {err}"))?;
    stream
        .write_all(&body)
        .map_err(|err| format!("write body: {err}"))?;
    stream
        .flush()
        .map_err(|err| format!("flush response: {err}"))
}

fn status_text(code: u16) -> &'static str {
    match code {
        200 => "OK",
        400 => "Bad Request",
        401 => "Unauthorized",
        404 => "Not Found",
        409 => "Conflict",
        422 => "Unprocessable Entity",
        500 => "Internal Server Error",
        503 => "Service Unavailable",
        504 => "Gateway Timeout",
        _ => "Error",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request(method: &str, path: &str, token: Option<&str>, body: &[u8]) -> ParsedRequest {
        let mut headers = HashMap::new();
        if let Some(token) = token {
            headers.insert("authorization".to_string(), format!("Bearer {token}"));
        }
        ParsedRequest {
            method: method.to_string(),
            path: path.to_string(),
            headers,
            body: body.to_vec(),
        }
    }

    #[test]
    fn route_requires_auth() {
        let req = request("GET", "/v1/tree", None, b"");
        let decision = route_request(&req, "token");
        match decision {
            RouteDecision::Immediate(response) => {
                assert_eq!(response.status_code, 401);
            }
            RouteDecision::Bridge(_) => panic!("expected immediate response"),
        }
    }

    #[test]
    fn route_health_when_authorized() {
        let req = request("GET", "/health", Some("secret"), b"");
        let decision = route_request(&req, "secret");
        match decision {
            RouteDecision::Immediate(response) => {
                assert_eq!(response.status_code, 200);
                assert_eq!(response.body["ok"], Value::Bool(true));
            }
            RouteDecision::Bridge(_) => panic!("expected immediate response"),
        }
    }

    #[test]
    fn route_tree_goes_through_bridge() {
        let req = request("GET", "/v1/tree", Some("secret"), b"");
        let decision = route_request(&req, "secret");
        match decision {
            RouteDecision::Bridge(DebugRequestKind::Tree) => {}
            _ => panic!("expected tree bridge route"),
        }
    }

    #[test]
    fn route_act_rejects_invalid_payload() {
        let req = request("POST", "/v1/act", Some("secret"), br#"{"element_id": 1}"#);
        let decision = route_request(&req, "secret");
        match decision {
            RouteDecision::Immediate(response) => {
                assert_eq!(response.status_code, 400);
                assert_eq!(response.body["error"]["code"], "invalid_act");
            }
            RouteDecision::Bridge(_) => panic!("expected immediate response"),
        }
    }

    #[test]
    fn parse_act_request_parses_args() {
        let payload = br#"{"element_id":"sidebar-rail","action":"click","args":{"times":2}}"#;
        let parsed = parse_act_request(payload).expect("act parse");
        assert_eq!(parsed.element_id, "sidebar-rail");
        assert_eq!(parsed.action, "click");
        assert_eq!(parsed.args.expect("args")["times"], Value::from(2));
    }

    #[test]
    fn parse_request_bytes_extracts_headers_and_body() {
        let bytes = b"POST /v1/act HTTP/1.1\r\nHost: localhost\r\nContent-Length: 13\r\nAuthorization: Bearer token\r\n\r\n{\"x\":\"hello\"}";
        let parsed = parse_request_bytes(bytes).expect("request parse");
        assert_eq!(parsed.method, "POST");
        assert_eq!(parsed.path, "/v1/act");
        assert_eq!(
            parsed
                .headers
                .get("authorization")
                .expect("authorization header"),
            "Bearer token"
        );
        assert_eq!(parsed.body, br#"{"x":"hello"}"#);
    }

    #[test]
    fn env_flag_enabled_accepts_truthy_values() {
        let key = "SANDPAPER_AGENT_DEBUG_TEST_FLAG";
        std::env::set_var(key, "true");
        assert!(env_flag_enabled(key));
        std::env::set_var(key, "1");
        assert!(env_flag_enabled(key));
        std::env::remove_var(key);
        assert!(!env_flag_enabled(key));
    }
}
