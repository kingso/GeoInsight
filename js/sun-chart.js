/* =========================================================
   GeoInsight — Sun Chart Module
   Solar position calculations + full-year chart rendering
   Based on NOAA solar calculations (ported from SunCalc)
   ========================================================= */

const RAD = Math.PI / 180;
const DAY_MS = 86400000;
const J1970 = 2440588;
const J2000 = 2451545;
const OBLIQUITY = RAD * 23.4397;

// ── Julian conversions ──────────────────────────────────
function toJulian(date)  { return date.valueOf() / DAY_MS - 0.5 + J1970; }
function fromJulian(j)   { return new Date((j + 0.5 - J1970) * DAY_MS); }
function toDays(date)    { return toJulian(date) - J2000; }

// ── Astronomical helpers ────────────────────────────────
function rightAscension(l, b) {
  return Math.atan2(
    Math.sin(l) * Math.cos(OBLIQUITY) - Math.tan(b) * Math.sin(OBLIQUITY),
    Math.cos(l)
  );
}

function declination(l, b) {
  return Math.asin(
    Math.sin(b) * Math.cos(OBLIQUITY) +
    Math.cos(b) * Math.sin(OBLIQUITY) * Math.sin(l)
  );
}

function solarMeanAnomaly(d) {
  return RAD * (357.5291 + 0.98560028 * d);
}

function eclipticLongitude(M) {
  const C = RAD * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M));
  const P = RAD * 102.9372;
  return M + C + P + Math.PI;
}

export { sunCoords, toDays, RAD };

function sunCoords(d) {
  const M = solarMeanAnomaly(d);
  const L = eclipticLongitude(M);
  return { dec: declination(L, 0), ra: rightAscension(L, 0) };
}

function hourAngle(h, phi, dec) {
  const v = (Math.sin(h) - Math.sin(phi) * Math.sin(dec)) / (Math.cos(phi) * Math.cos(dec));
  if (v > 1)  return 0;       // sun never sets (polar day)
  if (v < -1) return Math.PI; // sun never rises (polar night)
  return Math.acos(v);
}

function julianCycle(d, lw)  { return Math.round(d - 0.0009 - lw / (2 * Math.PI)); }
function approxTransit(Ht, lw, n) { return 0.0009 + Ht / (2 * Math.PI) + lw / (2 * Math.PI) + n; }
function solarTransitJ(ds, M, L)  { return J2000 + ds + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * L); }

function getSetJ(h, lw, phi, dec, n, M, L) {
  const w = hourAngle(h, phi, dec);
  const a = approxTransit(w, lw, n);
  return solarTransitJ(a, M, L);
}

// ── Public: Calculate sunrise/sunset/noon ───────────────
export function getSunTimes(date, lat, lng) {
  const lw  = RAD * -lng;
  const phi = RAD * lat;
  const d   = toDays(date);
  const n   = julianCycle(d, lw);
  const ds  = approxTransit(0, lw, n);
  const M   = solarMeanAnomaly(ds);
  const L   = eclipticLongitude(M);
  const Jnoon = solarTransitJ(ds, M, L);
  const sc  = sunCoords(d);
  const h0  = RAD * -0.833; // standard sunrise/sunset angle

  const Jset  = getSetJ(h0, lw, phi, sc.dec, n, M, L);
  const Jrise = Jnoon - (Jset - Jnoon);

  return {
    sunrise: fromJulian(Jrise),
    sunset:  fromJulian(Jset),
    noon:    fromJulian(Jnoon)
  };
}

// ── Public: Render full-year sun chart to canvas ────────
export function renderSunChart(canvas, lat, lng, timezone) {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const W = rect.width;
  const H = rect.height;
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);

  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  const pad = { t: 22, r: 12, b: 36, l: 48 };
  const cW = W - pad.l - pad.r;
  const cH = H - pad.t - pad.b;

  // Time formatter for the location's timezone
  const dtf = timezone
    ? new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: '2-digit', minute: '2-digit', hour12: false })
    : null;

  function localH(dt) {
    if (dtf) {
      const p = dtf.formatToParts(dt);
      return parseInt(p.find(x => x.type === 'hour').value) +
             parseInt(p.find(x => x.type === 'minute').value) / 60;
    }
    // Fallback: estimate from longitude
    const off = new Date(dt.getTime() + Math.round(lng / 15) * 3600000);
    return off.getUTCHours() + off.getUTCMinutes() / 60;
  }

  function fmtTime(dt) {
    if (dtf) return dtf.format(dt);
    const off = new Date(dt.getTime() + Math.round(lng / 15) * 3600000);
    return off.getUTCHours().toString().padStart(2, '0') + ':' +
           off.getUTCMinutes().toString().padStart(2, '0');
  }

  // Calculate data for every day of the year
  const now = new Date();
  const year = now.getFullYear();
  const jan1 = new Date(year, 0, 1);
  const totalDays = Math.round((new Date(year + 1, 0, 1) - jan1) / DAY_MS);
  const todayIdx = Math.floor((now - jan1) / DAY_MS);

  const data = [];
  for (let i = 0; i < totalDays; i++) {
    const dt = new Date(year, 0, 1 + i);
    const t = getSunTimes(dt, lat, lng);
    const rise = localH(t.sunrise);
    const set  = localH(t.sunset);
    data.push({ date: dt, rise, set, len: set - rise, riseDate: t.sunrise, setDate: t.sunset });
  }

  // ── Draw ──
  // Background
  ctx.fillStyle = '#0f1729';
  ctx.fillRect(0, 0, W, H);

  // Grid lines (hours)
  ctx.strokeStyle = '#1e293b';
  ctx.lineWidth = 1;
  for (let h = 0; h <= 24; h += 3) {
    const y = pad.t + cH - (h / 24) * cH;
    ctx.beginPath();
    ctx.moveTo(pad.l, y);
    ctx.lineTo(W - pad.r, y);
    ctx.stroke();

    ctx.fillStyle = '#64748b';
    ctx.font = '10px system-ui';
    ctx.textAlign = 'right';
    ctx.fillText(`${h.toString().padStart(2, '0')}:00`, pad.l - 6, y + 3);
  }

  // Month labels
  const months = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];
  for (let mo = 0; mo < 12; mo++) {
    const dt = new Date(year, mo, 1);
    const day = Math.floor((dt - jan1) / DAY_MS);
    const x = pad.l + (day / totalDays) * cW;

    ctx.beginPath();
    ctx.strokeStyle = '#1e293b';
    ctx.moveTo(x, pad.t);
    ctx.lineTo(x, H - pad.b);
    ctx.stroke();

    ctx.fillStyle = '#64748b';
    ctx.font = '10px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText(months[mo], x + cW / 24, H - pad.b + 14);
  }

  // Filled area between sunrise & sunset
  ctx.beginPath();
  data.forEach((item, i) => {
    const x = pad.l + (i / totalDays) * cW;
    const yR = pad.t + cH - (item.rise / 24) * cH;
    if (i === 0) ctx.moveTo(x, yR);
    else ctx.lineTo(x, yR);
  });
  for (let i = data.length - 1; i >= 0; i--) {
    const x = pad.l + (i / totalDays) * cW;
    const yS = pad.t + cH - (data[i].set / 24) * cH;
    ctx.lineTo(x, yS);
  }
  ctx.closePath();
  ctx.fillStyle = 'rgba(255, 215, 0, 0.06)';
  ctx.fill();

  // Sunrise line
  drawLine(ctx, data, 'rise', '#ffd700', pad, cW, cH, totalDays);
  // Sunset line
  drawLine(ctx, data, 'set', '#ff6b35', pad, cW, cH, totalDays);

  // Day length line (scaled to chart)
  const maxLen = Math.max(...data.map(d => d.len));
  ctx.beginPath();
  ctx.strokeStyle = '#4ecdc4';
  ctx.lineWidth = 1.5;
  data.forEach((item, i) => {
    const x = pad.l + (i / totalDays) * cW;
    const y = pad.t + cH - (item.len / Math.ceil(maxLen + 1)) * cH;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();

  // Solstices & equinoxes
  const events = [
    [new Date(year, 2, 20), 'Eq'],
    [new Date(year, 5, 21), 'Sol'],
    [new Date(year, 8, 22), 'Eq'],
    [new Date(year, 11, 21), 'Sol'],
  ];
  events.forEach(([d, label]) => {
    const idx = Math.floor((d - jan1) / DAY_MS);
    const x = pad.l + (idx / totalDays) * cW;
    ctx.beginPath();
    ctx.setLineDash([3, 3]);
    ctx.strokeStyle = '#e91e63';
    ctx.lineWidth = 1;
    ctx.moveTo(x, pad.t);
    ctx.lineTo(x, H - pad.b);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#e91e63';
    ctx.font = '9px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText(label, x, pad.t - 4);
  });

  // Today line
  if (todayIdx >= 0 && todayIdx < totalDays) {
    const todayX = pad.l + (todayIdx / totalDays) * cW;
    ctx.beginPath();
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.moveTo(todayX, pad.t);
    ctx.lineTo(todayX, H - pad.b);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#ffffff';
    ctx.font = '9px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText('Today', todayX, H - pad.b + 28);
  }

  // ── Hover interactivity ──
  const infoEl = document.getElementById('sun-chart-info');

  function handlePointer(ex, ey) {
    const r = canvas.getBoundingClientRect();
    const mx = (ex - r.left) * (W / r.width);
    const my = (ey - r.top) * (H / r.height);

    if (mx >= pad.l && mx <= W - pad.r && my >= pad.t && my <= H - pad.b) {
      const dayIdx = Math.floor(((mx - pad.l) / cW) * totalDays);
      if (dayIdx >= 0 && dayIdx < totalDays && infoEl) {
        const item = data[dayIdx];
        const dateStr = item.date.toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
        infoEl.innerHTML =
          `<strong>${dateStr}</strong> · ` +
          `☀️ <span style="color:#ffd700">${fmtTime(item.riseDate)}</span> — ` +
          `🌅 <span style="color:#ff6b35">${fmtTime(item.setDate)}</span> · ` +
          `⏱️ <span style="color:#4ecdc4">${Math.floor(item.len)}h ${Math.round((item.len % 1) * 60)}m</span>`;
      }
    }
  }

  canvas.onmousemove = ev => handlePointer(ev.clientX, ev.clientY);
  canvas.ontouchmove = ev => { ev.preventDefault(); handlePointer(ev.touches[0].clientX, ev.touches[0].clientY); };
  canvas.onmouseleave = () => { if (infoEl) infoEl.textContent = 'Hover over the chart for daily details'; };

  // Return today's data for the summary
  const todayData = data[todayIdx] || data[0];
  return {
    sunrise: fmtTime(todayData.riseDate),
    sunset:  fmtTime(todayData.setDate),
    dayLength: todayData.len,
    data
  };
}

// ── Helper: draw a data line ────────────────────────────
function drawLine(ctx, data, key, color, pad, cW, cH, totalDays) {
  ctx.beginPath();
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  data.forEach((item, i) => {
    const x = pad.l + (i / totalDays) * cW;
    const y = pad.t + cH - (item[key] / 24) * cH;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();
}
