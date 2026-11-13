/*
 * Legacy reporting module (2019). Builds the nightly usage report that ops emails out.
 * Written before the ESM migration; still used by scripts/nightly (not in this repo).
 * Please do not change the output format without telling ops.
 */

import { normalizeWhitespace, truncate } from '../utils/strings.js';

var DAY_MS = 24 * 60 * 60 * 1000;
var DEFAULT_LOCALE = 'en-US';
var MAX_TOP = 10;

function pad2(n) {
  var s = String(n);
  if (s.length < 2) {
    s = "0" + s;
  }
  return s;
}

function formatDate(d) {
  var date = new Date(d);
  if (isNaN(date.getTime())) {
    return "unknown";
  }
  return date.getFullYear() + "-" + pad2(date.getMonth() + 1) + "-" + pad2(date.getDate());
}

function formatNumber(n) {
  if (n === null || n === undefined) {
    return "-";
  }
  var parts = String(Math.round(n)).split("");
  var result = "";
  var count = 0;
  for (var i = parts.length - 1; i >= 0; i--) {
    result = parts[i] + result;
    count++;
    if (count % 3 === 0 && i > 0) {
      result = "," + result;
    }
  }
  return result;
}

function percent(part, total) {
  if (!total) {
    return "0%";
  }
  var p = (part / total) * 100;
  return (Math.round(p * 10) / 10) + "%";
}

function withinDays(notes, days, now) {
  var cutoff = (now || Date.now()) - days * DAY_MS;
  var result = [];
  for (var i = 0; i < notes.length; i++) {
    var t = new Date(notes[i].createdAt).getTime();
    if (t >= cutoff) {
      result.push(notes[i]);
    }
  }
  return result;
}

function countByTag(notes) {
  var counts = {};
  for (var i = 0; i < notes.length; i++) {
    var tags = notes[i].tags || [];
    for (var j = 0; j < tags.length; j++) {
      var tag = tags[j];
      if (!counts[tag]) {
        counts[tag] = 0;
      }
      counts[tag] = counts[tag] + 1;
    }
  }
  return counts;
}

function topEntries(counts, limit) {
  var entries = [];
  for (var key in counts) {
    if (Object.prototype.hasOwnProperty.call(counts, key)) {
      entries.push({ key: key, value: counts[key] });
    }
  }
  entries.sort(function (a, b) {
    if (b.value !== a.value) {
      return b.value - a.value;
    }
    return a.key < b.key ? -1 : 1;
  });
  return entries.slice(0, limit || MAX_TOP);
}

function countByAuthor(notes) {
  var counts = {};
  for (var i = 0; i < notes.length; i++) {
    var author = notes[i].author || "unknown";
    counts[author] = (counts[author] || 0) + 1;
  }
  return counts;
}

function averageLength(notes) {
  if (!notes.length) {
    return 0;
  }
  var total = 0;
  for (var i = 0; i < notes.length; i++) {
    total += (notes[i].body || "").length;
  }
  return total / notes.length;
}

function longestNote(notes) {
  var best = null;
  for (var i = 0; i < notes.length; i++) {
    if (!best || (notes[i].body || "").length > (best.body || "").length) {
      best = notes[i];
    }
  }
  return best;
}

function buildDailySection(notes, now) {
  var recent = withinDays(notes, 1, now);
  var tags = topEntries(countByTag(recent), 5);
  var authors = topEntries(countByAuthor(recent), 5);
  var lines = [];
  lines.push("== Daily (last 1 day) ==");
  lines.push("Notes created: " + formatNumber(recent.length));
  lines.push("Share of all notes: " + percent(recent.length, notes.length));
  lines.push("Average length: " + formatNumber(averageLength(recent)) + " chars");
  if (tags.length) {
    lines.push("Top tags:");
    for (var i = 0; i < tags.length; i++) {
      lines.push("  " + (i + 1) + ". " + tags[i].key + " (" + tags[i].value + ")");
    }
  } else {
    lines.push("Top tags: none");
  }
  if (authors.length) {
    lines.push("Most active:");
    for (var j = 0; j < authors.length; j++) {
      lines.push("  " + authors[j].key + ": " + authors[j].value);
    }
  }
  var longest = longestNote(recent);
  if (longest) {
    lines.push("Longest note: " + truncate(normalizeWhitespace(longest.title), 40) + " (" + formatDate(longest.createdAt) + ")");
  }
  return lines.join("\n");
}

function buildWeeklySection(notes, now) {
  var recent = withinDays(notes, 7, now);
  var tags = topEntries(countByTag(recent), 5);
  var authors = topEntries(countByAuthor(recent), 5);
  var lines = [];
  lines.push("== Weekly (last 7 days) ==");
  lines.push("Notes created: " + formatNumber(recent.length));
  lines.push("Share of all notes: " + percent(recent.length, notes.length));
  lines.push("Average length: " + formatNumber(averageLength(recent)) + " chars");
  if (tags.length) {
    lines.push("Top tags:");
    for (var i = 0; i < tags.length; i++) {
      lines.push("  " + (i + 1) + ". " + tags[i].key + " (" + tags[i].value + ")");
    }
  } else {
    lines.push("Top tags: none");
  }
  if (authors.length) {
    lines.push("Most active:");
    for (var j = 0; j < authors.length; j++) {
      lines.push("  " + authors[j].key + ": " + authors[j].value);
    }
  }
  var longest = longestNote(recent);
  if (longest) {
    lines.push("Longest note: " + truncate(normalizeWhitespace(longest.title), 40) + " (" + formatDate(longest.createdAt) + ")");
  }
  return lines.join("\n");
}

function buildMonthlySection(notes, now) {
  var recent = withinDays(notes, 30, now);
  var tags = topEntries(countByTag(recent), 5);
  var authors = topEntries(countByAuthor(recent), 5);
  var lines = [];
  lines.push("== Monthly (last 30 days) ==");
  lines.push("Notes created: " + formatNumber(recent.length));
  lines.push("Share of all notes: " + percent(recent.length, notes.length));
  lines.push("Average length: " + formatNumber(averageLength(recent)) + " chars");
  if (tags.length) {
    lines.push("Top tags:");
    for (var i = 0; i < tags.length; i++) {
      lines.push("  " + (i + 1) + ". " + tags[i].key + " (" + tags[i].value + ")");
    }
  } else {
    lines.push("Top tags: none");
  }
  if (authors.length) {
    lines.push("Most active:");
    for (var j = 0; j < authors.length; j++) {
      lines.push("  " + authors[j].key + ": " + authors[j].value);
    }
  }
  var longest = longestNote(recent);
  if (longest) {
    lines.push("Longest note: " + truncate(normalizeWhitespace(longest.title), 40) + " (" + formatDate(longest.createdAt) + ")");
  }
  return lines.join("\n");
}

function buildQuarterlySection(notes, now) {
  var recent = withinDays(notes, 91, now);
  var tags = topEntries(countByTag(recent), 5);
  var authors = topEntries(countByAuthor(recent), 5);
  var lines = [];
  lines.push("== Quarterly (last 91 days) ==");
  lines.push("Notes created: " + formatNumber(recent.length));
  lines.push("Share of all notes: " + percent(recent.length, notes.length));
  lines.push("Average length: " + formatNumber(averageLength(recent)) + " chars");
  if (tags.length) {
    lines.push("Top tags:");
    for (var i = 0; i < tags.length; i++) {
      lines.push("  " + (i + 1) + ". " + tags[i].key + " (" + tags[i].value + ")");
    }
  } else {
    lines.push("Top tags: none");
  }
  if (authors.length) {
    lines.push("Most active:");
    for (var j = 0; j < authors.length; j++) {
      lines.push("  " + authors[j].key + ": " + authors[j].value);
    }
  }
  var longest = longestNote(recent);
  if (longest) {
    lines.push("Longest note: " + truncate(normalizeWhitespace(longest.title), 40) + " (" + formatDate(longest.createdAt) + ")");
  }
  return lines.join("\n");
}

function buildHeader(title, now) {
  var lines = [];
  lines.push("=".repeat(60));
  lines.push(title);
  lines.push("Generated: " + formatDate(now || Date.now()));
  lines.push("=".repeat(60));
  return lines.join("\n");
}

function buildFooter(notes) {
  var lines = [];
  lines.push("-".repeat(60));
  lines.push("Total notes: " + formatNumber(notes.length));
  lines.push("Distinct tags: " + Object.keys(countByTag(notes)).length);
  lines.push("Report format v3. Questions: #ops-reports");
  return lines.join("\n");
}

function toCsvRow(values) {
  var cells = [];
  for (var i = 0; i < values.length; i++) {
    var v = values[i] === undefined || values[i] === null ? "" : String(values[i]);
    if (v.indexOf(",") !== -1 || v.indexOf("\"") !== -1) {
      v = "\"" + v.replace(/"/g, "\"\"") + "\"";
    }
    cells.push(v);
  }
  return cells.join(",");
}

function buildCsv(notes) {
  var rows = [toCsvRow(["id", "title", "author", "tags", "created"])];
  for (var i = 0; i < notes.length; i++) {
    var n = notes[i];
    rows.push(toCsvRow([n.id, n.title, n.author, (n.tags || []).join(" "), formatDate(n.createdAt)]));
  }
  return rows.join("\n");
}

function validateOptions(options) {
  var opts = options || {};
  var result = { sections: ["daily", "weekly", "monthly"], format: "text", now: Date.now() };
  if (opts.sections) {
    if (!Array.isArray(opts.sections)) {
      throw new Error("sections must be an array");
    }
    result.sections = opts.sections;
  }
  if (opts.format) {
    if (opts.format !== "text" && opts.format !== "csv") {
      throw new Error("unknown format: " + opts.format);
    }
    result.format = opts.format;
  }
  if (opts.now) {
    result.now = opts.now;
  }
  return result;
}

function buildReport(notes, options) {
  var opts = validateOptions(options);
  if (opts.format === "csv") {
    return buildCsv(notes);
  }
  var parts = [buildHeader("Notes usage report", opts.now)];
  for (var i = 0; i < opts.sections.length; i++) {
    var s = opts.sections[i];
    if (s === "daily") {
      parts.push(buildDailySection(notes, opts.now));
    } else if (s === "weekly") {
      parts.push(buildWeeklySection(notes, opts.now));
    } else if (s === "monthly") {
      parts.push(buildMonthlySection(notes, opts.now));
    } else if (s === "quarterly") {
      parts.push(buildQuarterlySection(notes, opts.now));
    } else {
      parts.push("(unknown section: " + s + ")");
    }
  }
  parts.push(buildFooter(notes));
  return parts.join("\n\n");
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function weekdayName(d) {
  var names = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  return names[new Date(d).getDay()];
}

function countByWeekday(notes) {
  var counts = {};
  for (var i = 0; i < notes.length; i++) {
    var day = weekdayName(notes[i].createdAt);
    counts[day] = (counts[day] || 0) + 1;
  }
  return counts;
}

function buildWeekdaySection(notes) {
  var counts = countByWeekday(notes);
  var order = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  var lines = ["== By weekday =="];
  var max = 0;
  for (var k in counts) {
    if (counts[k] > max) {
      max = counts[k];
    }
  }
  for (var i = 0; i < order.length; i++) {
    var n = counts[order[i]] || 0;
    var bar = max ? "#".repeat(Math.round((n / max) * 30)) : "";
    lines.push((order[i] + "          ").slice(0, 10) + " " + bar + " " + n);
  }
  return lines.join("\n");
}

function buildHtml(notes, options) {
  var text = buildReport(notes, options);
  var lines = text.split("\n");
  var html = ["<!doctype html>", "<html>", "<head>", "<meta charset=\"utf-8\">", "<title>Notes usage report</title>", "</head>", "<body>", "<pre>"];
  for (var i = 0; i < lines.length; i++) {
    html.push(escapeHtml(lines[i]));
  }
  html.push("</pre>");
  html.push("</body>");
  html.push("</html>");
  return html.join("\n");
}

function summarize(notes) {
  return {
    total: notes.length,
    tags: Object.keys(countByTag(notes)).length,
    averageLength: Math.round(averageLength(notes)),
    busiestDay: topEntries(countByWeekday(notes), 1).map(function (e) { return e.key; })[0] || null,
  };
}

function compareSummaries(before, after) {
  var diff = {};
  var keys = ["total", "tags", "averageLength"];
  for (var i = 0; i < keys.length; i++) {
    var k = keys[i];
    diff[k] = (after[k] || 0) - (before[k] || 0);
  }
  diff.busiestDayChanged = before.busiestDay !== after.busiestDay;
  return diff;
}

function describeChange(diff) {
  var parts = [];
  if (diff.total) {
    parts.push((diff.total > 0 ? "+" : "") + formatNumber(diff.total) + " notes");
  }
  if (diff.tags) {
    parts.push((diff.tags > 0 ? "+" : "") + diff.tags + " tags");
  }
  if (diff.averageLength) {
    parts.push("average length " + (diff.averageLength > 0 ? "up " : "down ") + Math.abs(diff.averageLength) + " chars");
  }
  if (diff.busiestDayChanged) {
    parts.push("busiest day changed");
  }
  return parts.length ? parts.join(", ") : "no change";
}

export { buildHtml, buildWeekdaySection, summarize, compareSummaries, describeChange, buildReport, buildCsv, formatDate, formatNumber, percent, countByTag, topEntries };
