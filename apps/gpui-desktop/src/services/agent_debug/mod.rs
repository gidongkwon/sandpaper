pub(crate) mod bridge;
pub(crate) mod screenshot;
pub(crate) mod server;

use bridge::AgentDebugBridge;
use std::sync::mpsc;

pub(crate) fn start_from_env() -> Result<Option<AgentDebugBridge>, String> {
    let Some(config) = server::AgentDebugServerConfig::from_env()? else {
        return Ok(None);
    };

    let (request_tx, request_rx) = mpsc::channel();
    let server = server::start_server(config, request_tx)?;
    Ok(Some(AgentDebugBridge {
        request_rx,
        _server: server,
    }))
}
