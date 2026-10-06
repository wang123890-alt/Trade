  async function fillFromName() {
    const name = nameInput.value.trim();
    if (lock || !name) return null;
    const hit = await lookupByName(name);
    if (!hit) return null;
    lock = true;
    idInput.value = hit.stockId;
    nameInput.value = hit.stockName;
    lock = false;
    return hit;
  }