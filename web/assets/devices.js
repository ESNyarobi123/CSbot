import {
  api, icon, esc, btn, heading, empty, dateLabel, pill, showModal, closeModal, notify,
  formData, formError, lockForm, nf,
} from './ui.js';

/**
 * The datasheet the bot answers "ina band gani", "ni 360°?", "ina mesh?" and
 * "inasimamia wateja wangapi?" from. Devices arrive faster than deploys, so this
 * page is the shop's own way to teach a new model.
 */
const fields = ['model', 'brand', 'deployment', 'wifi', 'bands', 'radios', 'antenna', 'gainDbi',
  'ports', 'poe', 'poeWatts', 'ipRating', 'coverageM', 'users', 'mesh', 'controller', 'mounting',
  'notes', 'sourceUrl', 'highlights', 'aliases'];

const deploymentLabel = (value) =>
  value === 'indoor' ? 'Indoor' : value === 'outdoor' ? 'Outdoor' : value === 'both' ? 'Indoor + outdoor' : '—';

export async function devices(container, signal) {
  let rows = await api('/device-specs?limit=100', { signal });
  if (signal.aborted) return;

  container.innerHTML = `${heading(
    'Devices',
    'The datasheet CSbot reasons from. Anything recorded here is quoted; anything missing is admitted.',
    btn('Add device', 'plus', 'data-add-record', 'primary'),
  )}
    <section class="card"><header class="card-head"><div class="card-title"><span class="card-icon">${icon('settings', 17)}</span>
      <div><h2>Models</h2><p>Only recorded fields are quoted to customers</p></div></div>
      <label class="field-search">${icon('search', 16)}<input aria-label="Search devices" type="search" placeholder="Search model or brand"></label></header><div id="records-list"></div></section>`;

  const list = container.querySelector('#records-list');
  const search = container.querySelector('input');

  function draw() {
    const query = search.value.trim().toLowerCase();
    const visible = rows.filter((item) =>
      [item.model, item.brand, item.wifi, item.bands].filter(Boolean).join(' ').toLowerCase().includes(query));
    list.innerHTML = visible.length
      ? `<div class="table-wrap"><table><thead><tr><th>Model</th><th>Class</th>
      <th>Wi-Fi</th><th>Range</th><th>Clients</th><th>Mesh</th><th>Status</th><th><span class="sr-only">Actions</span></th></tr></thead><tbody>
      ${visible.map((item) => `<tr>
        <td><div class="table-person"><span class="channel-icon">${icon('box', 17)}</span><span><b>${esc(item.model)}</b>
          <small>${esc(item.brand || '')}</small></span></div></td>
        <td>${esc(deploymentLabel(item.deployment))}</td>
        <td>${esc(item.wifi || '—')}</td>
        <td>${item.coverage_m ? `${nf.format(item.coverage_m)} m` : '—'}</td>
        <td>${item.users ? nf.format(item.users) : '—'}</td>
        <td>${item.mesh === true ? pill('Yes', 'green', false) : item.mesh === false ? 'No' : '—'}</td>
        <td>${item.verified
          ? pill('Verified', 'green')
          : pill('Needs check', 'amber', false)}</td>
        <td>${btn('Edit', 'edit', `data-edit="${esc(item.model_key)}"`, 'small')}</td></tr>`).join('')}
      </tbody></table></div>`
      : empty(query ? 'No matches' : 'No devices yet',
        query ? 'Try another model or brand.' : 'Add a device so CSbot can answer its specs.', 'settings');

    list.querySelectorAll('[data-edit]').forEach((button) =>
      (button.onclick = () => edit(rows.find((item) => item.model_key === button.dataset.edit))));
  }

  function edit(entry) {
    const seed = entry ?? {};
    const dialog = showModal(
      (entry ? 'Edit ' : 'Add ') + 'device',
      entry ? entry.model_key : '',
      `<form class="form-stack">
        <div class="form-row">
          <label>Model<input name="model" required maxlength="120" value="${esc(seed.model)}" placeholder="e.g. TP-LINK EAP 670" autofocus></label>
          <label>Brand<input name="brand" maxlength="80" value="${esc(seed.brand)}" placeholder="e.g. TP-Link"></label>
        </div>
        <label>Where it is used<select name="deployment">
          ${[['', 'Not recorded'], ['outdoor', 'Outdoor'], ['indoor', 'Indoor'], ['both', 'Indoor + outdoor']]
            .map(([id, label]) => `<option value="${id}" ${(seed.deployment ?? '') === id ? 'selected' : ''}>${label}</option>`)
            .join('')}</select></label>
        <div class="form-row">
          <label>Wi-Fi standard<input name="wifi" maxlength="120" value="${esc(seed.wifi)}" placeholder="e.g. 802.11ax (Wi-Fi 6, AX3000)"></label>
          <label>Bands<input name="bands" maxlength="120" value="${esc(seed.bands)}" placeholder="e.g. 2.4 GHz + 5 GHz"></label>
        </div>
        <label>MIMO / radios<input name="radios" maxlength="160" value="${esc(seed.radios)}" placeholder="e.g. 2.4 GHz 2×2 + 5 GHz 2×2"></label>
        <div class="form-row">
          <label>Antenna<input name="antenna" maxlength="160" value="${esc(seed.antenna)}" placeholder="e.g. Internal omni-directional"></label>
          <label>Antenna gain (dBi)<input name="gainDbi" type="number" step="0.1" min="0" max="60" value="${seed.gain_dbi ?? ''}" placeholder="e.g. 5"></label>
        </div>
        <div class="form-row">
          <label>Ports<input name="ports" maxlength="120" value="${esc(seed.ports)}" placeholder="e.g. 1× 10/100/1000 Mbps"></label>
          <label>Ingress rating<input name="ipRating" maxlength="40" value="${esc(seed.ip_rating)}" placeholder="e.g. IP65"></label>
        </div>
        <div class="form-row">
          <label>Power<input name="poe" maxlength="120" value="${esc(seed.poe)}" placeholder="e.g. 802.3at PoE"></label>
          <label>Power draw (W)<input name="poeWatts" type="number" step="0.1" min="0" max="2000" value="${seed.poe_watts ?? ''}" placeholder="e.g. 12.5"></label>
        </div>
        <div class="form-row">
          <label>Range (metres)<input name="coverageM" type="number" min="1" max="100000" value="${seed.coverage_m ?? ''}" placeholder="e.g. 200"></label>
          <label>Concurrent clients<input name="users" type="number" min="1" max="100000" value="${seed.users ?? ''}" placeholder="e.g. 80"></label>
        </div>
        <div class="form-row">
          <label>Mesh<select name="mesh">
            ${[['', 'Not recorded'], ['yes', 'Supports mesh'], ['no', 'No mesh']]
              .map(([id, label]) => `<option value="${id}" ${(seed.mesh === true ? 'yes' : seed.mesh === false ? 'no' : '') === id ? 'selected' : ''}>${label}</option>`)
              .join('')}</select></label>
          <label>Managed by<input name="controller" maxlength="160" value="${esc(seed.controller)}" placeholder="e.g. Omada SDN / Omada Cloud"></label>
        </div>
        <label>Mounting<input name="mounting" maxlength="160" value="${esc(seed.mounting)}" placeholder="e.g. Ceiling or wall bracket, IP65"></label>
        <label>Customer-facing highlights <small>one per line — the bot may quote these verbatim</small>
          <textarea name="highlights" rows="3" maxlength="1200" placeholder="Managed from the Omada controller&#10;One cable carries power and data">${esc((seed.highlights ?? []).join('\n'))}</textarea></label>
        <label>Other names customers type <small>one per line</small>
          <textarea name="aliases" rows="2" maxlength="600" placeholder="RAP6262&#10;RG RAP 6262">${esc((seed.aliases ?? []).join('\n'))}</textarea></label>
        <label>Internal note<textarea name="notes" rows="2" maxlength="2000" placeholder="Anything the team should know">${esc(seed.notes)}</textarea></label>
        <label>Source URL<input type="url" name="sourceUrl" value="${esc(seed.source_url)}" placeholder="https:// manufacturer datasheet"></label>
        <label class="checkbox"><input type="checkbox" name="verified" ${seed.verified ? 'checked' : ''}> Checked against the datasheet</label>
        <p class="form-error" role="alert"></p>
        <div class="modal-actions"><button class="btn primary" type="submit">Save device</button></div>
      </form>`,
    );
    const form = dialog.querySelector('form');
    form.onsubmit = async (event) => {
      event.preventDefault();
      lockForm(form, true);
      formError(form, '');
      try {
        const data = formData(form);
        // Empty boxes must arrive as "not recorded", never as an empty string the
        // bot would happily quote back to a customer.
        for (const key of fields) {
          if (data[key] === '' || data[key] === undefined) delete data[key];
        }
        data.verified = data.verified === 'on';
        if (data.mesh === 'yes') data.mesh = true;
        else if (data.mesh === 'no') data.mesh = false;
        else delete data.mesh;
        if (data.highlights) {
          data.highlights = String(data.highlights).split('\n').map(line => line.trim()).filter(Boolean).slice(0, 8);
          if (!data.highlights.length) delete data.highlights;
        }
        if (data.aliases) {
          data.aliases = String(data.aliases).split('\n').map(line => line.trim()).filter(Boolean).slice(0, 10);
          if (!data.aliases.length) delete data.aliases;
        }
        const key = seed.model_key
          || (data.model || '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
        if (!key) throw new Error('Model is required.');
        const result = await api('/device-specs/' + encodeURIComponent(key), { method: 'PUT', data });
        rows = [result, ...rows.filter((item) => item.model_key !== result.model_key)];
        if (!signal.aborted) {
          closeModal();
          draw();
          notify('Device saved.');
        }
      } catch (error) {
        formError(form, error.message);
      } finally {
        lockForm(form, false);
      }
    };
  }

  container.querySelector('[data-add-record]').onclick = () => edit();
  search.oninput = draw;
  draw();
}
