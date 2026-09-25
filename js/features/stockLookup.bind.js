import { lookupById, lookupByName } from '../data/stockLookup.js';

function bindStockLookup(form) {
  const idInput = form.querySelector('[name="stockId"]');
  const nameInput = form.querySelector('[name="stockName"]');
  if (!idInput || !nameInput) return;
  idInput.required = false;
  nameInput.required = false;
  idInput.setAttribute('autocomplete', 'off');
  nameInput.setAttribute('autocomplete', 'off');
  idInput.setAttribute('inputmode', 'numeric');

  let lock = false;
  let idTimer = 0;
  let nameTimer = 0;

  async function fromId() {
    const id = idInput.value.trim();
    if (lock || !id) return;
    if (nameInput.value.trim() && nameInput.dataset.fromLookup === id) return;
    const hit = await lookupById(id);
    if (!hit) return;
    lock = true;
    idInput.value = hit.stockId;
    nameInput.value = hit.stockName;
    nameInput.dataset.fromLookup = hit.stockId;
    lock = false;
  }

  function fromName() {
    const name = nameInput.value.trim();
    if (lock || !name || idInput.value.trim()) return;
    const hit = lookupByName(name);
    if (!hit) return;
    lock = true;
    idInput.value = hit.stockId;
    nameInput.value = hit.stockName;
    nameInput.dataset.fromLookup = hit.stockId;
    lock = false;
  }

  idInput.addEventListener('input', () => {
    clearTimeout(idTimer);
    const id = idInput.value.trim();
    if (id.length >= 4) idTimer = setTimeout(fromId, 180);
  });
  idInput.addEventListener('blur', fromId);
  idInput.addEventListener('change', fromId);
  nameInput.addEventListener('input', () => {
    clearTimeout(nameTimer);
    if (nameInput.value.trim().length >= 2) nameTimer = setTimeout(fromName, 180);
  });
  nameInput.addEventListener('blur', fromName);
  nameInput.addEventListener('change', fromName);

  form.addEventListener('submit', async (e) => {
    if (idInput.value.trim() && nameInput.value.trim()) return;
    if (idInput.value.trim()) await fromId();
    else fromName();
    if (!idInput.value.trim() || !nameInput.value.trim()) {
      e.preventDefault();
      e.stopImmediatePropagation();
      const box = form.parentElement.querySelector('#tx-form-errors');
      if (box) box.innerHTML = '<div class="error-banner">代號或名稱填一個，另一個要能自動對到</div>';
    }
  }, true);
}

export { bindStockLookup };
