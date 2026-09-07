/* Atlas Rent Optimizer — unofficial fan calculator.
   No network calls, no accounts, no analytics. Everything lives in this file
   plus whatever the visitor types, which is kept in their own localStorage. */
(function () {
  "use strict";

  /* ------------------------------------------------------------------ model */

  var RATES = { common: 1.1e-9, rare: 1.6e-9, epic: 2.2e-9, legendary: 4.4e-9 };
  var AVG_NEW = 1.58e-9;
  var HOURS_YEAR = 8760, SRB_EVENT_HOURS = 56, SRB_MULT = 50;
  var AB_PARCEL = 100, AB_BADGE = 200, AB_UPGRADE = 2500;
  var STORE_KEY = "atlas-rent-optimizer-v1";

  var TIERS = [
    [1, 150, 30], [151, 220, 20], [221, 290, 15], [291, 365, 12], [366, 435, 10],
    [436, 545, 8], [546, 625, 7], [626, 730, 6], [731, 875, 5], [876, 1100, 4],
    [1101, 1500, 3], [1501, Infinity, 2]
  ];
  var BADGES = [
    [101, 1.25, "Level 5"], [61, 1.20, "Level 4"], [31, 1.15, "Level 3"],
    [11, 1.10, "Level 2"], [1, 1.05, "Level 1"], [0, 1.00, "No level"]
  ];

  var EXAMPLE = {
    mode: "exact", common: 210, rare: 126, epic: 63, legendary: 21, total: 420,
    badges: 11, bucks: 2000, hours: 16, srb: true, cover: 80, events: 13,
    touched: false, stack: 8, winStart: null, winEnd: null, skipped: [],
    aec: true, abMonth: 3501, subCost: 49.99
  };

  /* Explorer Club has no rent multiplier. It changes stack length (8h vs 6h)
     and how fast Atlas Bucks accumulate from daily login rewards. */
  var AEC_AB_MONTH = 3501, FREE_AB_MONTH = 152, AEC_MONTH_COST = 49.99;
  var state = {};
  Object.keys(EXAMPLE).forEach(function (k) { state[k] = EXAMPLE[k]; });

  function tierOf(n) {
    for (var i = 0; i < TIERS.length; i++) if (n >= TIERS[i][0] && n <= TIERS[i][1]) return TIERS[i];
    return TIERS[0];
  }
  function badgeOf(b) {
    for (var i = 0; i < BADGES.length; i++) if (b >= BADGES[i][0]) return BADGES[i];
    return BADGES[BADGES.length - 1];
  }
  function nextBadgeStep(b) {
    var ups = [1, 11, 31, 61, 101];
    for (var i = 0; i < ups.length; i++) if (b < ups[i]) return ups[i];
    return null;
  }
  function parcelCount(s) { return s.mode === "total" ? s.total : (s.common + s.rare + s.epic + s.legendary); }
  function baseRate(s) {
    if (s.mode === "total") return s.total * AVG_NEW;
    return s.common * RATES.common + s.rare * RATES.rare + s.epic * RATES.epic + s.legendary * RATES.legendary;
  }
  function srbHours(s) { return s.srb ? s.events * SRB_EVENT_HOURS * (s.cover / 100) : 0; }
  function weightedSeconds(s, tier) {
    var sh = Math.min(srbHours(s), HOURS_YEAR), frac = s.hours / 24;
    return 3600 * (sh * SRB_MULT + (HOURS_YEAR - sh) * (frac * tier + (1 - frac)));
  }
  function annual(s, extra, badgeOverride) {
    extra = extra || 0;
    var n = parcelCount(s) + extra;
    var base = baseRate(s) + extra * AVG_NEW;
    var bm = (badgeOverride == null) ? badgeOf(s.badges)[1] : badgeOverride;
    return base * bm * weightedSeconds(s, tierOf(n)[2]);
  }

  var money = function (v, d) { return "$" + v.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d }); };
  var num = function (v) { return v.toLocaleString("en-US"); };
  function el(id) { return document.getElementById(id); }

  /* ------------------------------------------------------- time-zone helpers */

  /* Offset (ms) between a zone's wall clock and UTC at a given instant. */
  function tzOffsetMs(date, tz) {
    var dtf = new Intl.DateTimeFormat("en-US", {
      timeZone: tz, hour12: false,
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit"
    });
    var p = {};
    dtf.formatToParts(date).forEach(function (x) { p[x.type] = x.value; });
    var asUTC = Date.UTC(+p.year, +p.month - 1, +p.day, (+p.hour) % 24, +p.minute, +p.second);
    return asUTC - date.getTime();
  }
  /* The instant when it is y-m-d h:min in tz. Iterated so DST resolves. */
  function zonedToInstant(y, m, d, h, min, tz) {
    var guess = Date.UTC(y, m, d, h, min);
    for (var i = 0; i < 3; i++) guess = Date.UTC(y, m, d, h, min) - tzOffsetMs(new Date(guess), tz);
    return new Date(guess);
  }
  /* Next Thursday 16:00 America/Chicago that hasn't already passed. */
  function nextSrbWindow() {
    var CT = "America/Chicago", now = new Date();
    for (var i = 0; i < 15; i++) {
      var probe = new Date(now.getTime() + i * 86400000);
      var parts = new Intl.DateTimeFormat("en-US", {
        timeZone: CT, weekday: "short", year: "numeric", month: "2-digit", day: "2-digit"
      }).formatToParts(probe);
      var p = {};
      parts.forEach(function (x) { p[x.type] = x.value; });
      if (p.weekday !== "Thu") continue;
      var start = zonedToInstant(+p.year, +p.month - 1, +p.day, 16, 0, CT);
      if (start.getTime() > now.getTime() - 3600000) {
        return { start: start, end: new Date(start.getTime() + SRB_EVENT_HOURS * 3600000) };
      }
    }
    return { start: now, end: new Date(now.getTime() + SRB_EVENT_HOURS * 3600000) };
  }

  function toLocalInputValue(date) {
    var p = function (n) { return String(n).padStart(2, "0"); };
    return date.getFullYear() + "-" + p(date.getMonth() + 1) + "-" + p(date.getDate()) +
      "T" + p(date.getHours()) + ":" + p(date.getMinutes());
  }
  function fromLocalInputValue(v) {
    var m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(v || "");
    if (!m) return null;
    return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  }
  var fmtWhen = new Intl.DateTimeFormat(undefined, {
    weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit"
  });

  /* ---------------------------------------------------------- calculator UI */

  function renderBands(s) {
    var n = parcelCount(s), cur = tierOf(n), CAP = 1600;
    var host = el("bands"); host.textContent = "";
    TIERS.forEach(function (t) {
      var hi = (t[1] === Infinity ? CAP : t[1]);
      var d = document.createElement("div");
      d.className = "band" + (t === cur ? " cur" : "");
      d.style.flex = Math.max(hi - t[0] + 1, 40) + " 1 0";
      d.textContent = t[2] + "×";
      d.title = (t[1] === Infinity ? t[0] + "+" : t[0] + "–" + t[1]) + " parcels → " + t[2] + "×";
      host.appendChild(d);
    });
    var totalW = TIERS.reduce(function (a, t) { var hi = (t[1] === Infinity ? CAP : t[1]); return a + Math.max(hi - t[0] + 1, 40); }, 0);
    function pos(v) {
      var acc = 0;
      for (var i = 0; i < TIERS.length; i++) {
        var t = TIERS[i], hi = (t[1] === Infinity ? CAP : t[1]), w = Math.max(hi - t[0] + 1, 40);
        if (v <= hi || i === TIERS.length - 1) return (acc + Math.min(Math.max(v - t[0], 0), w)) / totalW * 100;
        acc += w;
      }
      return 100;
    }
    var axis = el("axis"); axis.textContent = "";
    function mark(v, label, cls) {
      var m = document.createElement("div");
      m.className = "mark " + (cls || "");
      m.style.left = Math.min(Math.max(pos(v), 2), 98) + "%";
      var tk = document.createElement("div"); tk.className = "tick";
      var lb = document.createElement("div"); lb.className = "lab"; lb.textContent = label;
      m.appendChild(tk); m.appendChild(lb); axis.appendChild(m);
    }
    mark(n, num(n), "you");
    if (cur[1] !== Infinity) mark(cur[1] + 1, "drop at " + num(cur[1] + 1), "cliff");
  }

  function renderCliff(s) {
    var host = el("cliffnote"); host.textContent = "";
    var n = parcelCount(s), cur = tierOf(n);
    var box = document.createElement("div");
    var ic = document.createElement("span"); ic.className = "ic";
    var body = document.createElement("div");
    box.appendChild(ic); box.appendChild(body);
    box.style.marginTop = "16px";

    if (cur[1] === Infinity) {
      box.className = "callout ok"; ic.textContent = "●";
      body.innerHTML = "<p>You're in the final <strong>2×</strong> band. No more tier drops — every parcel from here is straight addition.</p>";
      host.appendChild(box); return;
    }
    var headroom = cur[1] - n;
    var atCap = annual(s, headroom);
    var loss = atCap - annual(s, headroom + 1);
    var recover = null;
    for (var k = headroom + 1; k <= headroom + 4000; k++) {
      if (annual(s, k) >= atCap) { recover = n + k; break; }
    }
    if (loss <= 0.005) {
      box.className = "callout ok"; ic.textContent = "●";
      body.innerHTML = "<p>At these boost settings the next tier boundary costs you almost nothing — SRB coverage has flattened it. Buy freely.</p>";
    } else {
      box.className = headroom <= 25 ? "callout warn" : "callout ok";
      ic.textContent = headroom <= 25 ? "▲" : "●";
      body.innerHTML =
        "<p><strong>" + num(headroom) + " parcels of headroom</strong> left in the " + cur[2] +
        "× band, which tops out at " + num(cur[1]) + ". Buying past it drops you to " + tierOf(cur[1] + 1)[2] +
        "× and costs <strong>" + money(loss, 2) + "/year</strong> the moment you cross.</p>" +
        (recover
          ? "<p>You'd break even again at <strong>" + num(recover) + " parcels</strong> — " + num(recover - cur[1]) +
            " past the cap, roughly " + num((recover - cur[1]) * AB_PARCEL) + " AB. Cross in one committed run rather than drifting over.</p>"
          : "<p>At these settings the crossing doesn't pay back within a sensible range. Hold at the cap and spend on badges instead.</p>");
    }
    host.appendChild(box);
  }

  function renderAlloc(s) {
    var host = el("alloc"); host.textContent = "";
    var now = annual(s, 0);
    var n = parcelCount(s), cur = tierOf(n);
    var headroom = (cur[1] === Infinity) ? Infinity : cur[1] - n;
    var opts = [];

    var pGain = annual(s, 10) - now;
    opts.push({
      name: "Parcels",
      sub: (headroom !== Infinity && headroom < 10) ? "The next 10 would cross your tier boundary" : "10 parcels at 100 AB each",
      val: pGain, dead: pGain <= 0.005
    });

    var step = nextBadgeStep(s.badges);
    if (step) {
      var need = step - s.badges, cost = need * AB_BADGE;
      opts.push({
        name: "Badges",
        sub: need + " more (" + num(cost) + " AB) reaches " + badgeOf(step)[2] + " — nothing pays until you get there",
        val: (annual(s, 0, badgeOf(step)[1]) - now) / cost * 1000, dead: false
      });
    } else {
      opts.push({ name: "Badges", sub: "Level 5 reached — no further badge multiplier", val: 0, dead: true });
    }

    var srcRate = null, srcName = "";
    if (s.mode === "total" || s.common > 0) { srcRate = RATES.common; srcName = "a common"; }
    else if (s.rare > 0) { srcRate = RATES.rare; srcName = "a rare"; }
    else if (s.epic > 0) { srcRate = RATES.epic; srcName = "an epic"; }
    if (srcRate !== null) {
      var uGain = (RATES.legendary - srcRate) * badgeOf(s.badges)[1] * weightedSeconds(s, cur[2]) / AB_UPGRADE * 1000;
      opts.push({ name: "Legendary upgrades", sub: "2,500 AB lifts " + srcName + " parcel to legendary rent", val: uGain, dead: false });
    }

    var max = Math.max.apply(null, opts.map(function (o) { return o.val; }).concat([0.01]));
    var best = opts.reduce(function (a, b) { return b.val > a.val ? b : a; }, opts[0]);

    opts.sort(function (a, b) { return b.val - a.val; }).forEach(function (o) {
      var d = document.createElement("div");
      d.className = "abar " + (o.dead ? "dead" : (o === best ? "best" : "meh"));
      var lin = document.createElement("div"); lin.className = "lin";
      var nm = document.createElement("div"); nm.className = "nm";
      nm.appendChild(document.createTextNode(o.name));
      if (o === best && !o.dead) { var r = document.createElement("span"); r.className = "rank"; r.textContent = "best"; nm.appendChild(r); }
      var sm = document.createElement("small"); sm.textContent = o.sub; nm.appendChild(sm);
      var amt = document.createElement("div"); amt.className = "amt";
      amt.textContent = o.val <= 0.005 ? "no gain" : money(o.val, 2) + "/yr";
      lin.appendChild(nm); lin.appendChild(amt);
      var tr = document.createElement("div"); tr.className = "track";
      var fl = document.createElement("div"); fl.className = "fill";
      fl.style.width = Math.max(o.val / max * 100, o.val > 0.005 ? 2 : 0) + "%";
      tr.appendChild(fl); d.appendChild(lin); d.appendChild(tr);
      host.appendChild(d);
    });
  }

  /* ------------------------------------------------------- bucks & payback */

  function cloneState(s) {
    var c = {};
    Object.keys(s).forEach(function (k) { c[k] = Array.isArray(s[k]) ? s[k].slice() : s[k]; });
    return c;
  }
  /* Add parcels at the standard rarity draw so the base rate stays honest. */
  function addParcels(sim, k) {
    if (sim.mode === "total") { sim.total += k; return; }
    var c = Math.round(k * 0.50), r = Math.round(k * 0.30), e = Math.round(k * 0.15);
    sim.common += c; sim.rare += r; sim.epic += e;
    sim.legendary += Math.max(0, k - c - r - e);
  }
  /* Spend a pot of AB the way the allocation table says to: fill the current
     boost tier, complete the next badge level, then keep buying only if that
     actually helps — crossing a tier ceiling on a small pot is a net loss. */
  function simulateSpend(s, ab) {
    var sim = cloneState(s), before = annual(sim, 0), steps = [];
    var n = parcelCount(sim), cur = tierOf(n);
    if (cur[1] !== Infinity) {
      var buy = Math.min(cur[1] - n, Math.floor(ab / AB_PARCEL));
      if (buy > 0) { addParcels(sim, buy); ab -= buy * AB_PARCEL; steps.push(num(buy) + " parcels to the " + cur[2] + "× cap"); }
    }
    var step = nextBadgeStep(sim.badges);
    if (step) {
      var need = step - sim.badges, cost = need * AB_BADGE;
      if (ab >= cost) { sim.badges = step; ab -= cost; steps.push(need + " badges to " + badgeOf(step)[2]); }
    }
    var more = Math.floor(ab / AB_PARCEL);
    if (more > 0) {
      var held = annual(sim, 0), test = cloneState(sim);
      addParcels(test, more);
      if (annual(test, 0) > held) {
        sim = test; ab -= more * AB_PARCEL;
        steps.push(num(more) + " more parcels");
      } else {
        steps.push("bank the remaining " + num(Math.round(ab)) + " AB rather than cross the tier line");
      }
    }
    return { added: annual(sim, 0) - before, steps: steps };
  }

  function renderPayback(s) {
    el("out-abyear").textContent = num(Math.round(s.abMonth * 12)) + " AB";
    var sim = simulateSpend(s, s.abMonth * 12);
    el("out-abrent").textContent = "+" + money(sim.added, 2) + "/yr";

    var n = parcelCount(s), cur = tierOf(n);
    var monthsFor = function (ab) { return s.abMonth > 0 ? ab / s.abMonth : Infinity; };
    var fmtMonths = function (m) {
      if (!isFinite(m)) return "never";
      if (m < 1) return "< 1 mo";
      return m < 24 ? Math.ceil(m) + " mo" : (m / 12).toFixed(1) + " yr";
    };
    el("out-tocap").textContent = (cur[1] === Infinity) ? "no cap"
      : (cur[1] - n <= 0) ? "at cap"
      : fmtMonths(monthsFor((cur[1] - n) * AB_PARCEL));
    var step = nextBadgeStep(s.badges);
    el("out-tobadge").textContent = step ? fmtMonths(monthsFor((step - s.badges) * AB_BADGE)) : "maxed";
    el("out-subyear").textContent = s.aec ? money(s.subCost * 12, 0) : "—";

    el("ab-hint").textContent = s.aec
      ? "Explorer Club daily rewards come to about " + num(AEC_AB_MONTH) + " AB a month. Edit if yours differs."
      : "Without the club the daily reward is about " + num(FREE_AB_MONTH) + " AB a month. Edit if yours differs.";

    var plan = el("spendplan"); plan.textContent = "";
    if (sim.steps.length) {
      var p = document.createElement("p");
      p.style.cssText = "margin:0; font-size:13px; color:var(--ink-2)";
      p.innerHTML = "A year of bucks would go to: <strong style='color:var(--ink)'>" +
        sim.steps.join("</strong>, then <strong style='color:var(--ink)'>") + "</strong>.";
      plan.appendChild(p);
    }

    var host = el("paybacknote"); host.textContent = "";
    var box = document.createElement("div");
    var ic = document.createElement("span"); ic.className = "ic";
    var body = document.createElement("div");
    box.appendChild(ic); box.appendChild(body);

    var deltaMonth = s.aec ? (s.abMonth - FREE_AB_MONTH) : (AEC_AB_MONTH - s.abMonth);
    if (deltaMonth <= 0) {
      box.className = "callout ok"; ic.textContent = "●";
      body.innerHTML = "<p>At this bucks rate the club makes no difference to your income — the comparison only bites when membership actually changes how fast you accumulate.</p>";
      host.appendChild(box); return;
    }
    var deltaRent = simulateSpend(s, deltaMonth * 12).added;
    var costMonth = s.aec ? s.subCost : AEC_MONTH_COST;
    var costYear = costMonth * 12;
    var worth = deltaRent > costYear;
    box.className = worth ? "callout ok" : "callout warn";
    ic.textContent = worth ? "●" : "▲";
    var lead = s.aec
      ? "Your membership is worth <strong>" + num(Math.round(deltaMonth)) + " AB/month</strong> over the free tier."
      : "Joining would add about <strong>" + num(Math.round(deltaMonth)) + " AB/month</strong>.";
    var verdict = worth
      ? "A year of that buys <strong>" + money(deltaRent, 2) + "/year</strong> of rent — permanently — against " +
        money(costYear, 2) + "/year of subscription (" + money(costMonth, 2) + "/month). It pays for itself in <strong>" +
        (costYear / deltaRent * 12 < 1 ? "under a month" : Math.ceil(costYear / deltaRent * 12) + " months") + "</strong>."
      : "A year of that buys <strong>" + money(deltaRent, 2) + "/year</strong> of rent against <strong>" +
        money(costYear, 2) + "/year</strong> of subscription (" + money(costMonth, 2) + "/month) — about <strong>" +
        (costYear / deltaRent).toFixed(1) + "× what it returns</strong>. In pure rent terms it does not pay for itself.";
    body.innerHTML = "<p>" + lead + " " + verdict + "</p>";
    if (!worth) body.innerHTML += "<p>That's not automatically a reason to cancel — faster progression has its own value. It just isn't paying you back yet.</p>";
    host.appendChild(box);
  }

  /* --------------------------------------------------------- SRB planner UI */

  function windowDates() {
    var s = fromLocalInputValue(el("in-start").value);
    var e = fromLocalInputValue(el("in-end").value);
    if (!s || !e || e <= s) return null;
    return { start: s, end: e };
  }
  function schedule() {
    var w = windowDates();
    if (!w) return [];
    var stackMs = state.stack * 3600000;
    var out = [], t = w.start.getTime(), guard = 0;
    while (t < w.end.getTime() && guard++ < 200) {
      out.push({ at: new Date(t), covers: Math.min(stackMs, w.end.getTime() - t) });
      t += stackMs;
    }
    return out;
  }
  function isSkipped(i) { return state.skipped.indexOf(i) !== -1; }

  function renderPlanner() {
    var host = el("tops"); host.textContent = "";
    var w = windowDates(), list = schedule();
    if (!w || !list.length) {
      var p = document.createElement("div");
      p.className = "top-item";
      p.textContent = "Set a window that closes after it opens.";
      host.appendChild(p);
      el("plan-cov").textContent = "—"; el("plan-hours").textContent = "";
      return;
    }
    var now = Date.now(), coveredMs = 0;
    list.forEach(function (item, i) {
      if (!isSkipped(i)) coveredMs += item.covers;
      var row = document.createElement("div");
      row.className = "top-item" + (item.at.getTime() < now ? " past" : "");
      var cb = document.createElement("input");
      cb.type = "checkbox"; cb.checked = !isSkipped(i);
      cb.setAttribute("aria-label", "Top up at " + fmtWhen.format(item.at));
      cb.addEventListener("change", function () {
        var pos = state.skipped.indexOf(i);
        if (cb.checked) { if (pos !== -1) state.skipped.splice(pos, 1); }
        else if (pos === -1) state.skipped.push(i);
        touch(); scheduleNotifications();
      });
      var tn = document.createElement("span"); tn.className = "tnum"; tn.textContent = (i + 1);
      var tt = document.createElement("span"); tt.className = "ttime"; tt.textContent = fmtWhen.format(item.at);
      var tm = document.createElement("span"); tm.className = "tmeta";
      tm.textContent = (item.covers / 3600000).toFixed(1) + " h of cover";
      row.appendChild(cb); row.appendChild(tn); row.appendChild(tt); row.appendChild(tm);
      host.appendChild(row);
    });
    var windowMs = w.end - w.start;
    var pct = Math.round(coveredMs / windowMs * 100);
    el("plan-cov").textContent = pct + "%";
    el("plan-hours").textContent = "(" + (coveredMs / 3600000).toFixed(0) + " of " + (windowMs / 3600000).toFixed(0) + " hours)";
    el("btn-applycov").textContent = "Apply " + pct + "% to calculator";
    renderCountdown();
  }

  function renderCountdown() {
    var w = windowDates(), list = schedule(), now = Date.now();
    var box = el("countdown"), lab = el("cd-label"), val = el("cd-value");
    if (!w) { lab.textContent = "Next top-up in"; val.textContent = "—"; box.className = "countdown"; return; }

    var next = null;
    for (var i = 0; i < list.length; i++) {
      if (!isSkipped(i) && list[i].at.getTime() > now) { next = list[i].at.getTime(); break; }
    }
    var target, label, hot = false;
    if (now < w.start.getTime()) { target = w.start.getTime(); label = "Window opens in"; }
    else if (now > w.end.getTime()) { lab.textContent = "This window has closed"; val.textContent = "—"; box.className = "countdown"; return; }
    else if (next) { target = next; label = "Next top-up in"; hot = true; }
    else { lab.textContent = "No more top-ups planned"; val.textContent = "—"; box.className = "countdown"; return; }

    var d = Math.max(0, target - now);
    var h = Math.floor(d / 3600000), m = Math.floor(d % 3600000 / 60000), sec = Math.floor(d % 60000 / 1000);
    var p = function (x) { return String(x).padStart(2, "0"); };
    lab.textContent = label;
    val.textContent = (h > 0 ? h + "h " : "") + p(m) + "m " + p(sec) + "s";
    box.className = "countdown" + (hot && d < 3600000 ? " hot" : "");
  }

  /* In-app reminders. Only reliable while the page is alive — stated plainly
     in the UI, with the calendar export offered as the dependable route. */
  var timers = [];
  function scheduleNotifications() {
    timers.forEach(clearTimeout); timers = [];
    if (!("Notification" in window) || Notification.permission !== "granted") return;
    var list = schedule(), now = Date.now(), MAXDELAY = 2147483000;
    list.forEach(function (item, i) {
      if (isSkipped(i)) return;
      var delay = item.at.getTime() - now;
      if (delay <= 0 || delay > MAXDELAY) return;
      timers.push(setTimeout(function () {
        fire("Top up your boost", "SRB top-up " + (i + 1) + " — " + state.stack + " more hours at 50×.", "srb-" + i);
      }, delay));
    });
    var w = windowDates();
    if (w) {
      var d0 = w.start.getTime() - now;
      if (d0 > 0 && d0 < MAXDELAY) {
        timers.push(setTimeout(function () {
          fire("Super Rent Boost is live", "50× on every parcel. Start your first boost now.", "srb-open");
        }, d0));
      }
    }
  }
  function fire(title, body, tag) {
    try {
      if (navigator.serviceWorker && navigator.serviceWorker.controller) {
        navigator.serviceWorker.controller.postMessage({ type: "notify", title: title, body: body, tag: tag });
      } else {
        new Notification(title, { body: body, icon: "icon-192.png", tag: tag });
      }
    } catch (e) { /* notifications unavailable — the calendar export still works */ }
  }

  /* Calendar export: one all-window event plus an alarmed event per top-up. */
  function icsStamp(d) {
    var p = function (n) { return String(n).padStart(2, "0"); };
    return d.getUTCFullYear() + p(d.getUTCMonth() + 1) + p(d.getUTCDate()) + "T" +
      p(d.getUTCHours()) + p(d.getUTCMinutes()) + p(d.getUTCSeconds()) + "Z";
  }
  function buildIcs() {
    var w = windowDates(); if (!w) return null;
    var list = schedule(), now = new Date(), uid = 0;
    var L = [
      "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Atlas Rent Optimizer//Unofficial//EN",
      "CALSCALE:GREGORIAN", "METHOD:PUBLISH", "X-WR-CALNAME:Super Rent Boost plan"
    ];
    function ev(start, end, summary, desc, alarmMin) {
      L.push("BEGIN:VEVENT");
      L.push("UID:aro-" + now.getTime() + "-" + (uid++) + "@atlas-rent-optimizer");
      L.push("DTSTAMP:" + icsStamp(now));
      L.push("DTSTART:" + icsStamp(start));
      L.push("DTEND:" + icsStamp(end));
      L.push("SUMMARY:" + summary);
      L.push("DESCRIPTION:" + desc);
      if (alarmMin !== null) {
        L.push("BEGIN:VALARM", "ACTION:DISPLAY", "DESCRIPTION:" + summary,
          "TRIGGER:-PT" + alarmMin + "M", "END:VALARM");
      }
      L.push("END:VEVENT");
    }
    ev(w.start, w.end, "Super Rent Boost window (50x)",
      "All parcels earn 50x for this window regardless of boost tier. Stay boosted throughout.", 15);
    list.forEach(function (item, i) {
      if (isSkipped(i)) return;
      ev(item.at, new Date(item.at.getTime() + 5 * 60000),
        "Top up boost (" + (i + 1) + " of " + list.length + ")",
        "Watch ads to restack " + state.stack + " hours of 50x rent.", 0);
    });
    L.push("END:VCALENDAR");
    return L.join("\r\n");
  }
  function downloadIcs() {
    var text = buildIcs();
    if (!text) return;
    var blob = new Blob([text], { type: "text/calendar;charset=utf-8" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url; a.download = "super-rent-boost.ics";
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 1000);
  }

  /* ------------------------------------------------------------ main render */

  function render() {
    var s = state;
    el("in-common").value = s.common; el("in-rare").value = s.rare;
    el("in-epic").value = s.epic; el("in-legendary").value = s.legendary;
    el("in-total").value = s.total;
    el("in-badges").value = s.badges; el("in-bucks").value = s.bucks;
    el("in-hours").value = s.hours; el("in-srb").checked = s.srb;
    el("in-cover").value = s.cover; el("in-events").value = s.events;
    el("in-stack").value = String(s.stack);

    var exact = s.mode === "exact";
    el("exact-rows").hidden = !exact;
    el("total-rows").hidden = exact;
    el("mode-exact").setAttribute("aria-pressed", exact ? "true" : "false");
    el("mode-total").setAttribute("aria-pressed", exact ? "false" : "true");
    el("exbanner").hidden = s.touched;

    var n = parcelCount(s);
    el("out-total").textContent = num(n);
    var bl = badgeOf(s.badges), step = nextBadgeStep(s.badges);
    el("out-badgelvl").textContent = bl[2] + " · " + bl[1].toFixed(2) + "×" + (step ? "  (next at " + step + ")" : "");
    el("out-buyable").textContent = Math.floor(s.bucks / AB_PARCEL) + " parcels · " + Math.floor(s.bucks / AB_BADGE) + " badges";

    el("out-hours").textContent = s.hours + " / 24";
    el("out-cover").textContent = s.cover + "%";
    el("out-events").textContent = s.events + " / yr";
    el("in-cover").disabled = !s.srb;
    el("in-events").disabled = !s.srb;
    el("srb-toggle").className = "toggle" + (s.srb ? " on" : "");
    el("out-srbstate").textContent = s.srb
      ? "Taking part · 50×, tier-independent · " + Math.round(srbHours(s)) + " hrs/yr"
      : "Sitting them out";

    var yr = annual(s, 0);
    el("out-year").textContent = money(yr, 0);
    el("out-day").textContent = money(yr / 365, 2);
    el("out-month").textContent = money(yr / 12, 2);
    var tier = tierOf(n)[2];
    el("out-eff").textContent = (weightedSeconds(s, tier) / (HOURS_YEAR * 3600)).toFixed(2) + "×";
    var sh = Math.min(srbHours(s), HOURS_YEAR), frac = s.hours / 24;
    var srbPart = sh * SRB_MULT, rest = (HOURS_YEAR - sh) * (frac * tier + (1 - frac));
    el("out-srbshare").textContent = (srbPart + rest) > 0 ? Math.round(srbPart / (srbPart + rest) * 100) + "%" : "0%";
    el("out-badgemult").textContent = bl[1].toFixed(2) + "×";

    el("in-aec").checked = s.aec;
    el("in-abmonth").value = s.abMonth;
    el("in-subcost").value = s.subCost;
    el("aec-toggle").className = "toggle" + (s.aec ? " on" : "");
    el("out-aecstate").textContent = s.aec
      ? "Member · 8-hour stacking · bigger daily rewards"
      : "Not a member · 6-hour stacking";

    renderBands(s); renderCliff(s); renderAlloc(s); renderPlanner(); renderPayback(s);
  }

  /* ------------------------------------------------------------ persistence */

  var saveTimer = null;
  function setChip(t) { var c = el("savechip"); if (c) c.textContent = t; }
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      try {
        var body = {};
        Object.keys(state).forEach(function (k) { body[k] = state[k]; });
        body.winStart = el("in-start").value;
        body.winEnd = el("in-end").value;
        window.localStorage.setItem(STORE_KEY, JSON.stringify(body));
        setChip("saved on this device");
      } catch (e) { setChip("can't save here"); }
    }, 350);
  }
  function load() {
    try {
      var raw = window.localStorage.getItem(STORE_KEY);
      if (!raw) return false;
      var d = JSON.parse(raw);
      if (!d || typeof d !== "object") return false;
      Object.keys(EXAMPLE).forEach(function (k) {
        if (typeof EXAMPLE[k] === "number" && typeof d[k] === "number") state[k] = d[k];
        if (typeof EXAMPLE[k] === "boolean" && typeof d[k] === "boolean") state[k] = d[k];
      });
      if (d.mode === "exact" || d.mode === "total") state.mode = d.mode;
      if (Array.isArray(d.skipped)) state.skipped = d.skipped.filter(function (x) { return typeof x === "number"; });
      state.winStart = typeof d.winStart === "string" ? d.winStart : null;
      state.winEnd = typeof d.winEnd === "string" ? d.winEnd : null;
      return true;
    } catch (e) { return false; }
  }
  function touch() { state.touched = true; render(); save(); }

  /* ----------------------------------------------------------------- wiring */

  ["common", "rare", "epic", "legendary", "total", "badges", "bucks"].forEach(function (k) {
    var input = el("in-" + k);
    input.addEventListener("input", function () {
      var v = parseInt(input.value, 10);
      state[k] = isNaN(v) ? 0 : Math.max(0, v);
      touch();
    });
  });
  Array.prototype.forEach.call(document.querySelectorAll(".stepper button"), function (b) {
    b.addEventListener("click", function () {
      var k = b.parentNode.getAttribute("data-k");
      state[k] = Math.max(0, state[k] + parseInt(b.getAttribute("data-d"), 10));
      touch();
    });
  });
  el("in-hours").addEventListener("input", function () { state.hours = +this.value; touch(); });
  el("in-cover").addEventListener("input", function () { state.cover = +this.value; touch(); });
  el("in-events").addEventListener("input", function () { state.events = +this.value; touch(); });
  el("in-srb").addEventListener("change", function () { state.srb = this.checked; touch(); });

  /* Membership drives stack length and the default bucks rate; both stay editable. */
  el("in-aec").addEventListener("change", function () {
    state.aec = this.checked;
    state.stack = state.aec ? 8 : 6;
    state.abMonth = state.aec ? AEC_AB_MONTH : FREE_AB_MONTH;
    state.subCost = state.aec ? AEC_MONTH_COST : 0;
    state.skipped = [];
    touch(); scheduleNotifications();
  });
  el("in-abmonth").addEventListener("input", function () {
    var v = parseInt(this.value, 10);
    state.abMonth = isNaN(v) ? 0 : Math.max(0, v);
    touch();
  });
  el("in-subcost").addEventListener("input", function () {
    var v = parseFloat(this.value);
    state.subCost = isNaN(v) ? 0 : Math.max(0, v);
    touch();
  });
  el("mode-exact").addEventListener("click", function () {
    if (state.mode === "exact") return;
    var t = state.total;
    state.mode = "exact";
    state.common = Math.round(t * .5); state.rare = Math.round(t * .3);
    state.epic = Math.round(t * .15);
    state.legendary = Math.max(0, t - state.common - state.rare - state.epic);
    touch();
  });
  el("mode-total").addEventListener("click", function () {
    if (state.mode === "total") return;
    state.total = state.common + state.rare + state.epic + state.legendary;
    state.mode = "total"; touch();
  });
  el("btn-reset").addEventListener("click", function () {
    Object.keys(EXAMPLE).forEach(function (k) { state[k] = EXAMPLE[k]; });
    state.skipped = [];
    var w = nextSrbWindow();
    el("in-start").value = toLocalInputValue(w.start);
    el("in-end").value = toLocalInputValue(w.end);
    state.touched = false;
    render();
    try { window.localStorage.removeItem(STORE_KEY); setChip("not saved yet"); } catch (e) {}
  });

  el("in-start").addEventListener("change", function () { state.skipped = []; touch(); scheduleNotifications(); });
  el("in-end").addEventListener("change", function () { state.skipped = []; touch(); scheduleNotifications(); });
  el("in-stack").addEventListener("change", function () {
    state.stack = +this.value; state.skipped = []; touch(); scheduleNotifications();
  });
  el("btn-ics").addEventListener("click", downloadIcs);
  el("btn-applycov").addEventListener("click", function () {
    var w = windowDates(), list = schedule();
    if (!w) return;
    var covered = 0;
    list.forEach(function (it, i) { if (!isSkipped(i)) covered += it.covers; });
    state.cover = Math.round(covered / (w.end - w.start) * 100 / 5) * 5;
    state.srb = state.cover > 0;
    touch();
  });
  el("btn-notify").addEventListener("click", function () {
    if (!("Notification" in window)) {
      el("notifynote").textContent = "This browser doesn't support notifications — use the calendar download instead.";
      return;
    }
    Notification.requestPermission().then(function (p) {
      if (p === "granted") {
        el("btn-notify").textContent = "Reminders on";
        el("btn-notify").disabled = true;
        scheduleNotifications();
        fire("Reminders on", "You'll be nudged at each top-up while the app is open.", "srb-test");
      } else {
        el("notifynote").textContent = "Notifications were declined. The calendar download works regardless — it uses your phone's own alarms.";
      }
    });
  });

  /* ------------------------------------------------------------------- boot */

  if (load()) setChip("saved on this device");
  var w = nextSrbWindow();
  el("in-start").value = state.winStart || toLocalInputValue(w.start);
  el("in-end").value = state.winEnd || toLocalInputValue(w.end);
  if (state.winStart && fromLocalInputValue(state.winStart) &&
      fromLocalInputValue(state.winStart).getTime() + 7 * 86400000 < Date.now()) {
    /* Stored window is more than a week stale — roll it forward. */
    el("in-start").value = toLocalInputValue(w.start);
    el("in-end").value = toLocalInputValue(w.end);
    state.skipped = [];
  }
  render();
  setInterval(renderCountdown, 1000);

  if ("Notification" in window && Notification.permission === "granted") {
    el("btn-notify").textContent = "Reminders on";
    el("btn-notify").disabled = true;
    scheduleNotifications();
  }

  /* Service worker + install prompt */
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", function () {
      navigator.serviceWorker.register("sw.js").then(function () {
        el("offlinechip").hidden = false;
      }).catch(function () {});
    });
  }
  var deferredPrompt = null;
  window.addEventListener("beforeinstallprompt", function (e) {
    e.preventDefault(); deferredPrompt = e;
    el("installbar").hidden = false;
  });
  el("btn-install").addEventListener("click", function () {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    deferredPrompt.userChoice.then(function () {
      deferredPrompt = null; el("installbar").hidden = true;
    });
  });
  window.addEventListener("appinstalled", function () { el("installbar").hidden = true; });

  /* iOS gives no install prompt — tell people the gesture instead. */
  var isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
              (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  var standalone = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
  if (isIOS && !standalone) {
    el("installtext").innerHTML = "<b>Add this to your Home Screen.</b> Tap Share, then “Add to Home Screen” — it runs offline after that.";
    el("btn-install").hidden = true;
    el("installbar").hidden = false;
  }
})();
