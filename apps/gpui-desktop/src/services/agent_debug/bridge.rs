use serde_json::{json, Value};
use std::sync::mpsc::{Receiver, Sender};

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct DebugActRequest {
    pub(crate) element_id: String,
    pub(crate) action: String,
    pub(crate) args: Option<Value>,
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) enum DebugRequestKind {
    Tree,
    Snapshot,
    Act(DebugActRequest),
}

#[derive(Debug)]
pub(crate) struct DebugRequestEnvelope {
    pub(crate) kind: DebugRequestKind,
    pub(crate) respond_to: Sender<DebugResponse>,
}

#[derive(Debug, Clone)]
pub(crate) struct DebugResponse {
    pub(crate) status_code: u16,
    pub(crate) body: Value,
}

impl DebugResponse {
    pub(crate) fn ok(body: Value) -> Self {
        Self {
            status_code: 200,
            body,
        }
    }

    pub(crate) fn error(status_code: u16, code: &str, message: &str) -> Self {
        Self {
            status_code,
            body: json!({
                "ok": false,
                "error": {
                    "code": code,
                    "message": message,
                }
            }),
        }
    }
}

pub(crate) struct AgentDebugBridge {
    pub(crate) request_rx: Receiver<DebugRequestEnvelope>,
    pub(crate) _server: super::server::AgentDebugServerHandle,
}
