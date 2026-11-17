import { btn, esc, icon, phoneLabel } from './ui.js';

export const testMessage = 'Habari, subscription ya LubFy bei gani?';

const codeGroups = (code) => {
  const raw = String(code ?? '')
    .replace(/[^a-z0-9]/gi, '')
    .toUpperCase();
  return raw.match(/.{1,4}/g) ?? [raw];
};

export function linkSteps(current, result) {
  const step =
    current.status === 'connected'
      ? 2
      : current.status === 'verifying'
        ? 2
        : result.qrDataUrl || result.pairingCode
          ? 1
          : 0;
  const done = current.status === 'connected';
  return `<ol class="device-steps" aria-label="Device connection progress">${[
    'Prepare',
    'Link device',
    'Connected',
  ]
    .map((label, index) => {
      const complete = done || step > index;
      const active = !done && index === step;
      return `<li class="${complete ? 'complete' : active ? 'current' : ''}" ${active ? 'aria-current="step"' : ''}>
        <span class="step-mark">${complete ? icon('check', 13) : index + 1}</span><span>${label}</span></li>`;
    })
    .join('')}</ol>`;
}

export function connectedDevice(account, result) {
  return `${linkSteps(account, result)}<div class="device-success">
    <span class="connected-mark">${icon('check', 25)}</span><div><strong>WhatsApp is connected</strong>
    <p>${
      result.workerHealthy === true
        ? 'The reply worker is active. Send a test message to confirm the full flow.'
        : result.workerHealthy === false
          ? 'Check the reply worker in Docker before testing replies.'
          : 'Checking the reply worker…'
    }</p></div></div>
    ${
      result.workerHealthy !== true
        ? ''
        : `<div class="test-reply"><div>
      <strong>Test a reply from another phone</strong><p>Send this to <b>${phoneLabel(account.phone)}</b> on WhatsApp.</p>
      <code>${esc(testMessage)}</code></div>${btn('Copy message', 'copy', 'data-copy-test', 'small')}</div>`
    }
    <a class="btn secondary device-inbox" href="#inbox/account/${esc(account.id)}">${icon('inbox', 16)} Open this number’s inbox ${icon('arrow', 14)}</a>`;
}

const instructions = (method) => `<ol class="link-instructions">
  <li><span>1</span><div><b>Open WhatsApp</b><small>On the phone that owns this number</small></div></li>
  <li><span>2</span><div><b>Tap Linked devices</b><small>Under Settings on iPhone, or the ⋮ menu on Android</small></div></li>
  <li><span>3</span><div><b>${method === 'qr' ? 'Tap Link a device and scan this QR' : 'Choose Link with phone number'}</b>
    <small>${method === 'qr' ? 'Point the phone’s camera at the code' : 'Enter the code shown here'}</small></div></li></ol>`;

/** The QR stays still and readable; only the frame and the waiting hint animate around it. */
function qrView(result) {
  return `<div class="qr-stage">
    <div class="scan-shell">
      <span class="scan-glow" aria-hidden="true"></span>
      <div class="qr-frame" data-qr-frame>
        <i></i><i></i><i></i><i></i>
        <img class="pair-qr" alt="QR code to link this WhatsApp number" src="${esc(result.qrDataUrl)}" width="168" height="168">
      </div>
    </div>
    <div class="qr-refresh"><span class="qr-progress" aria-hidden="true"><i></i></span>
      <span class="qr-time" data-qr-time></span></div>
    <span class="awaiting" aria-hidden="true"><i></i><i></i><i></i>Waiting for you to scan</span>
  </div>`;
}

function codeView(code) {
  return `<div class="device-wait code-wait">
    <span class="code-eyebrow">${icon('key', 14)} Your pairing code</span>
    <div class="pair-code" aria-label="Pairing code ${esc(code)}">${codeGroups(code)
      .map(
        (group, groupIndex) =>
          `<span class="pair-group">${[...group]
            .map((character, index) => `<i style="--i:${groupIndex * 4 + index}">${esc(character)}</i>`)
            .join('')}</span>`,
      )
      .join('')}</div>
    <p>Enter this on your phone under <b>Linked devices → Link with phone number</b></p>
    <button type="button" class="text-button copy-code" data-copy-code>${icon('copy', 14)} Copy code</button>
    <span class="code-expiry" data-code-time>Expires automatically. Request a new code if it stops working.</span>
  </div>`;
}

export function linkPanel(method, result, failedConnection) {
  if (result.status === 'verifying') {
    return `<div class="device-wait verify-device"><span class="link-loader">${icon('link', 23)}</span>
      <strong>Finishing the connection</strong><p>WhatsApp is verifying this number. Keep the phone online.</p></div>`;
  }
  const linkOffline = result.gatewayHealthy === false || failedConnection;
  const qr =
    typeof result.qrDataUrl === 'string'
      ? /^data:image\/png;base64,[a-z0-9+/=]+$/i.test(result.qrDataUrl)
      : false;
  const usableQr = qr && Number(result.qrRemainingMs) > 0;
  let content;
  if (linkOffline) {
    content = `<div class="device-wait"><span class="link-loader static">${icon('alert', 21)}</span>
      <strong>${result.gatewayHealthy === false ? 'Waiting for the WhatsApp gateway' : 'Couldn’t check the connection'}</strong>
      <p>${result.gatewayHealthy === false ? 'Check the gateway in Docker and try again.' : 'CSbot will try again in a moment.'}</p>
      ${btn('Check now', 'refresh', 'data-check-link', 'small')}</div>`;
  } else if (method === 'code') {
    const requesting = result.pairingState === 'requesting';
    const retry = ['failed', 'expired'].includes(result.pairingState);
    content = result.pairingCode
      ? codeView(result.pairingCode)
      : `<div class="device-wait"><span class="link-loader ${requesting ? '' : 'static'}">${icon('key', 23)}</span>
        <strong>${requesting ? 'Waiting for WhatsApp' : retry ? 'Request a fresh code' : 'Link with a code'}</strong>
        ${
          requesting
            ? '<p>WhatsApp is preparing your pairing code.</p><span class="awaiting" aria-hidden="true"><i></i><i></i><i></i>Usually ready in a few seconds</span>'
            : btn(retry ? 'Request again' : 'Request pairing code', 'key', 'data-code', 'primary')
        }</div>`;
  } else if (usableQr) {
    content = qrView(result);
  } else {
    content = `<div class="device-wait"><span class="link-loader">${icon('qr', 23)}</span>
      <strong>${qr ? 'Refreshing the QR code' : 'Preparing a secure QR code'}</strong><p>A fresh code will appear automatically.</p>
      ${btn('Check now', 'refresh', 'data-check-link', 'small')}</div>`;
  }
  return `<div class="link-panel ${method === 'code' ? 'code-panel' : ''}"><div class="link-card">${content}</div>${instructions(method)}</div>`;
}
