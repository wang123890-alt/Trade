import { lookupById, lookupByName } from '../data/stockLookup.js';

function bindStockLookup(form) {
  const idInput = form.querySelector('[name="stockId"]');
  const nameInput = form.querySelector('[name="stockName"]');
  if (!idInput || !nameInput) return;
  idInput.required = false;
  nameInput.required = false;

  let lock = false;

  async function fromId() {
    const id = idInput.value.trim();
    if (lock || !id || nameInput.value.trim()) return;
    const hit = await lookupById(id);
    if (!hit) return;
    lock = true;
    idInput.value = hit.stockId;
    nameInput.value = hit.stockName;
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
    lock = false;
  }

  idInput.addEventListener('blur', fromId);
  idInput.addEventListener('change', fromId);
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
