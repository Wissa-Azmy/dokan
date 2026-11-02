// Inflation-aware pricing. Suggested price =
//   average cost × (1 + pass% × (rate now ÷ rate when bought − 1)) × (1 + markup%), rounded to the shop's step.
// "Rate when bought" is the weighted average rate of the stock on hand: avgCost ÷ avgCostUsd.
import { round2 } from './buying.js';

// Product's own markup, else its category's, else the main category's, else the shop's.
export function effectiveMarkup(product, categories, settings) {
  if (product.markupPct != null) return { pct: product.markupPct, from: 'product' };
  const cat = (categories || []).find((c) => c.id === product.categoryId);
  if (cat?.markupPct != null) return { pct: cat.markupPct, from: 'category' };
  const parent = cat?.parentId && categories.find((c) => c.id === cat.parentId);
  if (parent?.markupPct != null) return { pct: parent.markupPct, from: 'category' };
  return { pct: Number(settings?.markupPct ?? 0), from: 'shop' };
}

export function roundToStep(n, step) {
  const s = Number(step) || 0;
  if (s <= 0) return round2(n);
  return Math.max(s, Math.round(n / s) * s);
}

export const buyRate = (cost) => (cost?.avgCostUsd ? cost.avgCost / cost.avgCostUsd : null);

// Cost moved with the dollar, by the share of the change the shop passes on.
export function adjustedCost(cost, rateNow, passPct = 100) {
  if (!cost?.avgCost) return null;
  const r0 = buyRate(cost);
  if (!r0 || !rateNow) return cost.avgCost;
  return cost.avgCost * (1 + (Number(passPct) / 100) * (rateNow / r0 - 1));
}

// Returns null when the product has no cost yet.
export function suggestedPrice(product, cost, categories, settings) {
  const adj = adjustedCost(cost, settings?.usdRate, settings?.passThroughPct ?? 100);
  if (adj == null) return null;
  const markup = effectiveMarkup(product, categories, settings);
  const raw = adj * (1 + markup.pct / 100);
  return { price: roundToStep(raw, settings?.roundStep), raw: round2(raw), adjCost: round2(adj), markup, buyRate: buyRate(cost) };
}

// The worked example shown in the info box, using the shop's own settings.
export function workedExample(settings) {
  const cost = 100;
  const r0 = 50;
  const r1 = Number(settings?.usdRate) || 52;
  const pass = Number(settings?.passThroughPct ?? 100);
  const markup = Number(settings?.markupPct ?? 25);
  const step = Number(settings?.roundStep) || 0;
  const adj = cost * (1 + (pass / 100) * (r1 / r0 - 1));
  const raw = adj * (1 + markup / 100);
  return { cost, r0, r1, pass, markup, step, adj: round2(adj), raw: round2(raw), price: roundToStep(raw, step) };
}
