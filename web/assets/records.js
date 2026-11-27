import {
  api,
  icon,
  esc,
  btn,
  heading,
  empty,
  dateLabel,
  customer,
  initials,
  pill,
  stagePill,
  showModal,
  closeModal,
  notify,
  formData,
  formError,
  lockForm,
  slug,
  nf,
} from './ui.js';

const collectionNames = { knowledge: 'Knowledge', products: 'Products' };
const pageSize = 30;

function orderChange(conversationId, saleId, stage, refresh) {
  const complete = stage === 'completed';
  const dialog = showModal(
    complete ? 'Complete order' : 'Confirm payment',
    `Order #${saleId}`,
    `<form class="form-stack"><label>${complete ? 'Fulfillment note' : 'Verification note'}<textarea name="reason" required minlength="3" maxlength="250"
      rows="3" autofocus placeholder="${complete ? 'e.g. Equipment handed to customer' : 'e.g. Payment matched to POS receipt'}"></textarea></label>
      <p class="form-error" role="alert"></p><div class="modal-actions"><button type="submit" class="btn primary">${complete ? 'Complete order' : 'Confirm payment'}</button></div></form>`,
  );
  const form = dialog.querySelector('form');
  form.onsubmit = async (event) => {
    event.preventDefault();
    lockForm(form, true);
    formError(form, '');
    try {
      await api('/conversations/' + conversationId + '/sale', {
        method: 'POST',
        data: { saleId, stage, reason: formData(form).reason },
      });
      closeModal();
      notify(complete ? 'Order completed.' : 'Payment confirmed.');
      await refresh();
    } catch (error) {
      formError(form, error.message);
    } finally {
      lockForm(form, false);
    }
  };
}

async function saleDetail(container, signal, conversationId, saleId) {
  const prefix = '/conversations/' + conversationId;
  const path = prefix + '/sales/' + saleId;
  async function refresh() {
    const [chat, sale, events] = await Promise.all([
      api(prefix, { signal }),
      api(path, { signal }),
      api(path + '/events', { signal }),
    ]);
    if (signal.aborted) return;
    const name = customer(chat);
    const latest = chat.sale?.id === saleId;
    container.innerHTML = `<a class="quiet-link back-link" href="#sales">${icon('back', 15)} All sales</a>
      ${heading('Order #' + sale.id, name, `<a href="#inbox/${conversationId}" class="btn secondary">${icon('inbox', 16)} Open conversation</a>`)}
      <div class="detail-grid"><section class="card"><header class="card-head"><div class="card-title"><span class="card-icon">${icon('bag', 17)}</span><div><h2>Order details</h2><p>Opened ${dateLabel(sale.opened_at)}</p></div></div>${stagePill(sale.stage)}</header>
        <div class="record-detail"><h3>Quote</h3><p>${esc(sale.quote?.text || 'No quote has been recorded.')}</p>
          ${sale.quote?.finalInvoice ? `<a class="quiet-link" href="/v1${prefix}/documents/${esc(sale.quote.finalInvoice.mediaId)}" download>Download ${esc(sale.quote.finalInvoice.name)}</a>` : ''}
          ${latest && !sale.closed_at ? btn(sale.stage === 'paid' ? 'Complete order' : 'Confirm payment', 'check', 'data-finish', 'primary') : ''}</div></section>
        <section class="card"><header class="card-head"><div class="card-title"><span class="card-icon">${icon('clock', 17)}</span><div><h2>Order history</h2><p>Updates for this order</p></div></div></header>
          <div class="event-timeline">${events
            .map(
              (item) => `<div class="event-line"><span class="event-dot"></span><div>${stagePill(item.stage)}
            <small>${dateLabel(item.created_at)}</small><p>${esc(item.reason === 'customer_message' ? 'Updated from a customer message' : item.reason === 'admin_opened' ? 'Opened by an admin' : item.reason || '')}</p></div></div>`,
            )
            .join('')}</div></section></div>`;
    const action = container.querySelector('[data-finish]');
    if (action)
      action.onclick = () =>
        orderChange(conversationId, saleId, sale.stage === 'paid' ? 'completed' : 'paid', refresh);
  }
  await refresh();
}

export async function sales(container, signal, segments) {
  if (segments.length === 2 && segments.every((part) => /^\d+$/.test(part))) {
    await saleDetail(container, signal, segments[0], segments[1]);
    return;
  }
  let orders = [];
  let more = true;
  container.innerHTML = `${heading('Sales', 'Track quotes, payment reports and completed orders.')}
    <section class="card"><header class="card-head"><div class="card-title"><span class="card-icon">${icon('bag', 17)}</span><div><h2>Customer orders</h2><p>Orders across WhatsApp numbers</p></div></div></header><div id="orders-list"></div></section>`;
  const list = container.querySelector('#orders-list');
  async function load() {
    const before = orders.at(-1)?.id;
    const rows = await api('/dashboard/sales?limit=' + pageSize + (before ? '&before=' + before : ''), {
      signal,
    });
    if (signal.aborted) return;
    orders.push(...rows);
    more = rows.length === pageSize;
    list.innerHTML = orders.length
      ? `<div class="table-wrap"><table><thead><tr><th>Order</th><th>Customer</th><th>WhatsApp number</th><th>Status</th><th>Updated</th></tr></thead><tbody>
      ${orders
        .map(
          (
            order,
          ) => `<tr><td><a class="order-id" href="#sales/${order.conversation_id}/${order.id}">#${order.id}</a></td>
        <td><div class="table-person"><span class="person">${esc(initials(customer(order)))}</span><b>${esc(customer(order))}</b></div></td>
        <td>${esc(order.account_label)}</td><td>${stagePill(order.stage)}</td><td>${dateLabel(order.updated_at)}</td></tr>`,
        )
        .join('')}
        </tbody></table></div>${more ? '<button data-more class="text-button load-more">Load more orders</button>' : ''}`
      : empty(
          'No orders yet',
          'Orders will appear here as customers request quotes and proceed to payment.',
          'bag',
        );
    const next = list.querySelector('[data-more]');
    if (next)
      next.onclick = async () => {
        next.disabled = true;
        try {
          await load();
        } catch (error) {
          if (!signal.aborted) notify(error.message, true);
        } finally {
          next.disabled = false;
        }
      };
  }
  await load();
}

export async function collection(container, signal, type) {
  if (type === 'products') return products(container, signal);
  return knowledge(container, signal);
}

async function knowledge(container, signal) {
  let [entries, reviewItems] = await Promise.all([
    api('/knowledge?limit=100', { signal }), api('/knowledge/review-items', { signal }),
  ]);
  if (signal.aborted) return;
  container.innerHTML = `${heading(
    'Knowledge',
    'Manage the business information CSbot uses in replies.',
    btn('Add article', 'plus', 'data-add-record', 'primary'),
  )}
    <section class="card"><header class="card-head"><div class="card-title"><span class="card-icon">${icon('book', 17)}</span>
      <div><h2>Articles</h2><p>Published articles answer customer questions</p></div></div>
      <label class="field-search">${icon('search', 16)}<input aria-label="Search knowledge" type="search" placeholder="Search knowledge"></label></header><div id="records-list"></div></section>
    <section class="card"><header class="card-head"><div class="card-title"><span class="card-icon">${icon('inbox', 17)}</span>
      <div><h2>Learning review</h2><p>Suggestions, corrections and fixes confirmed by customers</p></div></div></header><div id="learning-list"></div></section>`;
  const list = container.querySelector('#records-list');
  const reviewList = container.querySelector('#learning-list');
  const search = container.querySelector('input');
  function draw() {
    const query = search.value.trim().toLowerCase();
    const visible = entries.filter((item) =>
      [item.title, item.system, item.tags].filter(Boolean).join(' ').toLowerCase().includes(query),
    );
    list.innerHTML = visible.length
      ? `<div class="table-wrap"><table><thead><tr><th>Article</th><th>System</th>
      <th>Status</th><th>Updated</th><th><span class="sr-only">Actions</span></th></tr></thead><tbody>
      ${visible
        .map(
          (item) => `<tr><td><div class="table-person"><span class="channel-icon">${icon('book', 17)}</span><span><b>${esc(item.title)}</b>
        <small>${esc(item.tags)}</small></span></div></td><td>${esc(item.system)}</td>
        <td>${pill(item.published ? 'Published' : 'Draft', item.published ? 'green' : 'gray')}</td>
        <td>${dateLabel(item.updated_at)}</td><td>${btn('Edit', 'edit', `data-edit="${esc(item.id)}"`, 'small')}</td></tr>`,
        )
        .join('')}</tbody></table></div>`
      : empty(query ? 'No matches' : 'No articles yet', query ? 'Try another search.' : 'Add an article to get started.', 'book');
    list
      .querySelectorAll('[data-edit]')
      .forEach((button) => (button.onclick = () => edit(entries.find((item) => item.id === button.dataset.edit))));
  }
  function drawReview() {
    const labels = { suggestion: 'Suggestion', correction: 'Correction', resolved: 'Confirmed fix' };
    reviewList.innerHTML = reviewItems.length ? `<div class="table-wrap"><table>
      <thead><tr><th>Type</th><th>System</th><th>Customer feedback or fix</th><th><span class="sr-only">Actions</span></th></tr></thead>
      <tbody>${reviewItems.map(item => `<tr><td>${esc(labels[item.kind])}</td><td>${esc(item.system)}</td><td>${esc(item.sample)}</td>
        <td>${btn('Draft', 'edit', `data-review="${esc(item.id)}"`, 'small')}
        ${btn('Dismiss', 'close', `data-dismiss-review="${esc(item.id)}"`, 'small')}</td></tr>`).join('')}</tbody>
      </table></div>` : empty('Nothing to review', 'New customer feedback will appear here.', 'inbox');
    reviewList.querySelectorAll('[data-review]').forEach(button => {
      button.onclick = () => edit(undefined, reviewItems.find(item => item.id === button.dataset.review));
    });
    reviewList.querySelectorAll('[data-dismiss-review]').forEach(button => {
      button.onclick = async () => {
        try {
          await api('/knowledge/review-items/' + button.dataset.dismissReview, { method: 'PATCH' });
          reviewItems = reviewItems.filter(item => item.id !== button.dataset.dismissReview);
          if (!signal.aborted) drawReview();
        } catch (error) { notify(error.message); }
      };
    });
  }
  function edit(entry, review) {
    const seed = entry ?? { system: review?.system };
    const dialog = showModal(
      (entry ? 'Edit ' : 'Add ') + 'article',
      '',
      `<form class="form-stack">
         ${review ? `<p>Review any customer-specific details before writing the draft.</p><blockquote>${esc(review.sample)}</blockquote>` : ''}
         <label>Title<input name="title" required maxlength="160" value="${esc(seed.title)}" autofocus></label>
         <label>System<select name="system">${[
           ['general', 'General'],
           ['wotefy', 'WoteFy'],
           ['lubfy', 'LubFy'],
         ]
           .map(([id, label]) => `<option value="${id}" ${seed.system === id ? 'selected' : ''}>${label}</option>`)
           .join('')}</select></label>
         <label>Content<textarea name="content" required rows="6" maxlength="8000">${esc(seed.content)}</textarea></label>
         <label>Tags<input name="tags" maxlength="500" value="${esc(seed.tags)}" placeholder="e.g. setup, pricing"></label>
         <label>Source URL<input type="url" name="sourceUrl" value="${esc(seed.source_url)}" placeholder="https://"></label>
         ${review ? '' : `<label class="checkbox"><input type="checkbox" name="published" ${seed.published ? 'checked' : ''}> Publish for CSbot replies</label>`}
      <p class="form-error" role="alert"></p><div class="modal-actions"><button class="btn primary" type="submit">Save article</button></div></form>`,
    );
    const form = dialog.querySelector('form');
    form.onsubmit = async (event) => {
      event.preventDefault();
      lockForm(form, true);
      formError(form, '');
      try {
        const data = formData(form);
        data.published = data.published === 'on';
        if (!data.sourceUrl) delete data.sourceUrl;
        if (review) data.reviewItemId = review.id;
        const id = review ? 'learn-' + review.id :
          seed.id || (slug(data.title).slice(0, 36) || 'article') + '-' + crypto.randomUUID().slice(0, 7);
        const result = await api('/knowledge/' + id, { method: 'PUT', data });
        entries = [result, ...entries.filter((item) => item.id !== id)];
        if (review) reviewItems = reviewItems.filter(item => item.id !== review.id);
        if (!signal.aborted) {
          closeModal();
          draw();
          drawReview();
          notify('Article saved.');
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
  drawReview();
}

const priceLabel = (item) =>
  item.price ? `${item.price.currency || 'TZS'} ${nf.format(item.price.amount)}` : 'Price not set';

function stockPill(item) {
  if (item.available === null || item.available === undefined) return pill('Local entry', 'gray', false);
  if (item.type === 'Service') return pill('Service', 'blue', false);
  return item.available ? pill('In stock', 'green') : pill('Out of stock', 'red');
}

function productPhoto(item, size = 30) {
  return item.image
    ? `<img src="${esc(item.image)}" alt="${esc(item.name)}" loading="lazy" decoding="async">`
    : `<span class="product-photo-empty">${icon('box', size)}</span>`;
}

/** Shop photos are megabytes wide; a cold cache can lose the race, so retry once. */
function retryPhotos(scope) {
  const retry = (img) => {
    const attempts = Number(img.dataset.attempts ?? '0');
    if (!img.getAttribute('src') || attempts >= 1) {
      img.closest('.product-media, .product-detail-media')?.classList.add('blank');
      return;
    }
    img.dataset.attempts = String(attempts + 1);
    window.setTimeout(() => {
      const url = new URL(img.getAttribute('src'), location.href);
      url.searchParams.set('retried', String(Date.now()));
      img.src = url.pathname + url.search;
    }, 600);
  };
  for (const img of scope.querySelectorAll('img')) {
    img.addEventListener('error', () => retry(img));
    if (img.complete && !img.naturalWidth) retry(img);
  }
}

function openProduct(item) {
  const facts = [
    ['SKU', item.sku],
    ['Brand', item.brand],
    ['Category', item.category],
    ['Type', item.type],
    ['Unit', item.unit],
    ['Warranty', item.warranty ? `${item.warranty} month${item.warranty === 1 ? '' : 's'}` : ''],
    ['Stock', item.type === 'Service' ? 'Made to order' : item.available_to_sell],
  ].filter(([, value]) => value !== null && value !== undefined && value !== '');
  const reply = [
    `${item.name} — ${priceLabel(item)}`,
    [item.brand && `Brand: ${item.brand}`, item.category && `Category: ${item.category}`,
      item.warranty ? `Warranty: ${item.warranty} months` : ''].filter(Boolean).join(' · '),
    item.available ? 'Ipo stock kwa sasa.' : item.type === 'Service' ? 'Huduma hii inafanywa kwa oda.' : 'Imeisha stock kwa sasa.',
  ].filter(Boolean).join('\n');
  const dialog = showModal(
    item.name,
    item.brand || 'CSolution catalog',
    `<div class="product-detail">
      <div class="product-detail-gallery"><div class="product-detail-media">${productPhoto(item, 46)}</div>
        <div class="product-thumbs" data-thumbs></div></div>
      <div class="product-detail-info">
        <div class="product-price">${esc(priceLabel(item))}</div>
        <div class="product-pills">${stockPill(item)}${item.type ? pill(item.type, 'blue', false) : ''}</div>
        <dl>${facts.map(([label, value]) => `<dt>${esc(label)}</dt><dd>${esc(value)}</dd>`).join('')}</dl>
        ${item.description ? `<p class="product-description">${esc(item.description)}</p>` : ''}
      </div>
    </div>
    <p class="product-note">${icon('bot', 14)} CSbot sends this price and photo automatically when a customer asks on WhatsApp.</p>
    <div class="modal-actions"><button class="btn secondary" data-copy-reply>${icon('copy', 15)} Copy reply</button>
      <button class="btn primary" data-close-product>Done</button></div>`,
  );
  dialog.querySelector('[data-copy-reply]').onclick = async () => {
    try {
      await navigator.clipboard.writeText(reply);
      notify('Reply copied.');
    } catch {
      notify('Copy failed — select the text manually.', true);
    }
  };
  const cover = dialog.querySelector('.product-detail-media img');
  retryPhotos(dialog);
  if (cover && cover.complete && cover.naturalWidth && (cover.naturalWidth < 240 || cover.naturalHeight < 240)) {
    dialog.querySelector('.product-detail-media')?.classList.add('small');
  }
  dialog.querySelector('[data-close-product]').onclick = () => closeModal();
  // The list only carries the cover photo, so the other shots arrive with the detail call.
  void (async () => {
    try {
      const full = await api('/catalog/' + encodeURIComponent(item.id));
      const photos = (full.images ?? []).filter(Boolean);
      const thumbs = dialog.querySelector('[data-thumbs]');
      if (!thumbs || photos.length < 2) return;
      thumbs.innerHTML = photos
        .map((url, index) => `<button type="button" class="product-thumb${index === 0 ? ' active' : ''}"
          data-photo="${esc(url)}" aria-label="Photo ${index + 1}">${index + 1}</button>`)
        .join('');
      thumbs.querySelectorAll('[data-photo]').forEach((button) => {
        button.onclick = () => {
          const media = dialog.querySelector('.product-detail-media');
          media.classList.remove('blank');
          media.innerHTML = `<img src="${esc(button.dataset.photo)}" alt="${esc(item.name)}">`;
          thumbs.querySelectorAll('.product-thumb').forEach((chip) =>
            chip.classList.toggle('active', chip === button));
        };
      });
    } catch {
      /* the cover photo already shown is enough */
    }
  })();
}

async function products(container, signal) {
  const response = await api('/catalog?limit=100', { signal });
  if (signal.aborted) return;
  const live = response.source === 'pos' || response.source === 'database';
  const items = response.items ?? [];
  const missingPhotos = items.filter((item) => !item.image).length;
  container.innerHTML = `${heading(
    'Products',
    live ? 'Live prices, stock, brands and photos from CSolution POS.' : 'Connect CSolution POS to show live prices and photos.',
    btn('Refresh', 'refresh', 'data-refresh', 'secondary') +
      (live ? '' : btn('Add local entry', 'plus', 'data-add-record', 'primary')),
  )}
    ${live
      ? `<div class="catalog-live"><span class="live-dot"></span><b>Live from CSolution POS</b><span>${items.length} active ${items.length === 1 ? 'product' : 'products'} · prices and stock refresh on every page load</span></div>`
      : `<div class="catalog-offline">${icon('alert', 16)}<div><b>POS catalog not connected</b><p>Set <code>POS_BASE_URL</code> and <code>POS_API_TOKEN</code> to the CSolution catalog API to show live prices, brands and photos.</p></div></div>`}
    <div class="product-stats">
      <div><span>Products</span><strong>${nf.format(items.length)}</strong></div>
      <div><span>In stock</span><strong>${nf.format(items.filter((item) => item.available).length)}</strong></div>
      <div><span>With photos</span><strong>${nf.format(items.filter((item) => item.image).length)}</strong></div>
      <div><span>Services</span><strong>${nf.format(items.filter((item) => item.type === 'Service').length)}</strong></div>
    </div>
    ${live && missingPhotos > 0
      ? `<p class="catalog-hint">${icon('image', 15)}<span><b>${missingPhotos}</b> of ${items.length} products have no photo yet.
        Add one in CSolution → Catalog so CSbot can send it on WhatsApp.</span></p>`
      : ''}
    <section class="card"><header class="card-head"><div class="card-title"><span class="card-icon">${icon('box', 17)}</span>
      <div><h2>Product catalog</h2><p>${live ? 'Brand, price, stock and photo from the shop database' : 'Local entries until the POS is connected'}</p></div></div>
      <label class="field-search">${icon('search', 16)}<input aria-label="Search products" type="search" placeholder="Search name, SKU or brand"></label></header>
      <div id="product-grid" class="product-grid"></div></section>`;
  const grid = container.querySelector('#product-grid');
  const search = container.querySelector('input[type="search"]');

  function draw() {
    const query = search.value.trim().toLowerCase();
    const visible = items.filter((item) =>
      [item.name, item.sku, item.brand, item.category, item.description]
        .filter(Boolean).join(' ').toLowerCase().includes(query),
    );
    grid.innerHTML = visible.length
      ? visible
          .map(
            (item, index) => `<article class="product-card" data-open="${esc(item.id)}" style="animation-delay:${Math.min(index, 12) * 28}ms">
        <div class="product-media${item.image ? '' : ' blank'}">${productPhoto(item)}${stockPill(item)}</div>
        <div class="product-body"><div class="product-brand">${esc(item.brand || 'CSolution')}</div>
          <h3>${esc(item.name)}</h3><p class="product-meta">${esc([item.sku, item.category].filter(Boolean).join(' · '))}</p>
          <div class="product-foot"><span class="product-price">${esc(priceLabel(item))}</span>
            ${btn('Details', 'arrow', 'data-details', 'secondary')}</div></div></article>`,
          )
          .join('')
      : empty(query ? 'No matching products' : 'No products yet',
          query ? 'Try a different name, SKU or brand.' : 'Add products in CSolution to see them here.', 'box');
    retryPhotos(grid);
    grid.querySelectorAll('img').forEach((image) => {
      const measure = () => {
        const media = image.closest('.product-media');
        // A 64px placeholder stretched over the card looks like a broken image, so keep it small.
        if (media && image.naturalWidth && (image.naturalWidth < 240 || image.naturalHeight < 240)) {
          media.classList.add('small');
        }
      };
      if (image.complete && image.naturalWidth) measure();
      else image.onload = measure;
    });
    grid.querySelectorAll('[data-open]').forEach((card) => {
      const item = items.find((entry) => entry.id === card.dataset.open);
      card.onclick = () => item && openProduct(item);
    });
  }

  async function editLocal(entry) {
    const seed = entry ?? {};
    const dialog = showModal(
      (entry ? 'Edit ' : 'Add ') + 'local product',
      'Used only when the POS catalog is not connected.',
      `<form class="form-stack"><label>Product name<input name="name" required maxlength="160" value="${esc(seed.name)}" autofocus></label>
       <label>SKU<input name="sku" required maxlength="80" value="${esc(seed.sku)}"></label>
       <label>Description<textarea name="description" rows="4" maxlength="800">${esc(seed.description)}</textarea></label>
       <label>Photo URL<input type="url" name="imageUrl" value="${esc(seed.image_url)}" placeholder="https://"></label>
       <p class="form-error" role="alert"></p><div class="modal-actions"><button class="btn primary" type="submit">Save product</button></div></form>`,
    );
    const form = dialog.querySelector('form');
    form.onsubmit = async (event) => {
      event.preventDefault();
      lockForm(form, true);
      formError(form, '');
      try {
        const data = formData(form);
        if (!data.imageUrl) delete data.imageUrl;
        const id = seed.id || (slug(data.sku).slice(0, 36) || 'product') + '-' + crypto.randomUUID().slice(0, 7);
        await api('/products/' + id, { method: 'PUT', data });
        closeModal();
        notify('Product saved.');
        await products(container, signal);
      } catch (error) {
        formError(form, error.message);
      } finally {
        lockForm(form, false);
      }
    };
  }

  container.querySelector('[data-refresh]').onclick = async (event) => {
    event.currentTarget.disabled = true;
    try {
      await products(container, signal);
    } catch (error) {
      if (!signal.aborted) notify(error.message, true);
    }
  };
  const add = container.querySelector('[data-add-record]');
  if (add) add.onclick = () => editLocal(items.find(() => false));
  search.oninput = draw;
  draw();
}
