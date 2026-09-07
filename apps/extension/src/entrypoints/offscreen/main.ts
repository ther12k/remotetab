/**
 * Offscreen media host scaffold. Capture (#006) and the WebRTC sender
 * (#007) will live here. Service workers cannot host media, so everything
 * that touches MediaStream/RTCPeerConnection belongs in this document.
 */

export {};

// Placeholder heartbeat so the document is not idle-terminated while a
// session is active; real keepalive arrives with the media wiring.
console.debug('remotetab offscreen host ready');
