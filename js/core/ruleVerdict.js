import { ENTRY_ADX_MIN, ENTRY_VOL_RATIO } from './tradeLevels.js';

function renderRuleVerdict(levels) {
  if (!levels) {
    return `<div class="verdict">
      <div class="verdict-kicker">規則判斷 · 四關</div>
      <div class="text-faint" style="font-size:12.5px;">K線不足30根，無法計算</div>
    </div>`;
  }
  const gates = [
    { name: '多頭排列', ok: levels.trend === 'up', detail: levels.trendLabel },
    { name: '20日新高', ok: !!levels.isBreakout, detail: levels.isBreakout ? '收盤過前20日高' : '未過前20日高' },
    { name: 'ADX', ok: levels.adx != null && levels.adx >= ENTRY_ADX_MIN, detail: levels.adx == null ? '無資料' : `${levels.adx} / 門檻 ${ENTRY_ADX_MIN}` },
    { name: '量能', ok: levels.volumeRatio != null && levels.volumeRatio >= ENTRY_VOL_RATIO, detail: levels.volumeRatio == null ? '無資料' : `${levels.volumeRatio}× / 門檻 ${ENTRY_VOL_RATIO}×` },
  ];
  const passed = gates.filter((g) => g.ok).length;
  const exitOn = !!levels.exit?.signal;
  const tone = exitOn ? 'out' : passed === 4 ? 'in' : 'wait';
  const title = exitOn ? '出場條件成立' : passed === 4 ? '進場四關全過' : `進場 ${passed}/4`;
  return `<div class="verdict verdict-${tone}">
    <div class="verdict-head">
      <div>
        <div class="verdict-kicker">規則判斷 · 四關</div>
        <div class="verdict-title">${title}</div>
      </div>
      <div class="verdict-score">${passed}/4</div>
    </div>
    <div class="gate-row">
      ${gates.map((g) => `<div class="gate ${g.ok ? 'gate-ok' : 'gate-no'}"><span>${g.name}</span><b>${g.ok ? '過' : '未過'}</b><small>${g.detail}</small></div>`).join('')}
    </div>
    <div class="verdict-note">${exitOn ? levels.exit.basis : (levels.entry?.basis || (levels.entrySkip || []).join('；') || '條件未齊')}</div>
    <div class="verdict-foot">計算結果，不是買賣建議。出場看收盤＜MA5 且 MA5＜MA10。</div>
  </div>`;
}

export { renderRuleVerdict };
