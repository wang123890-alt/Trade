const KEY = 'trade_app.risk.v1';

function getRiskSettings() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '{}');
    const capital = Number(raw.capital);
    const riskPct = Number(raw.riskPct);
    return {
      capital: capital > 0 ? capital : null,
      riskPct: riskPct > 0 ? riskPct : 1,
    };
  } catch {
    return { capital: null, riskPct: 1 };
  }
}

function setRiskSettings({ capital, riskPct }) {
  const next = {
    capital: Number(capital) > 0 ? Number(capital) : '',
    riskPct: Number(riskPct) > 0 ? Number(riskPct) : 1,
  };
  localStorage.setItem(KEY, JSON.stringify(next));
  return getRiskSettings();
}

export { getRiskSettings, setRiskSettings };
