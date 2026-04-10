"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// scripts/reparse-plenary.ts
var dotenv = __toESM(require("dotenv"));
var import_client = require("@libsql/client");
var import_better_sqlite3 = __toESM(require("better-sqlite3"));
var import_path = __toESM(require("path"));
dotenv.config({ path: ".env.local" });
if (!process.env.TURSO_URL) throw new Error("TURSO_URL not set");
var turso = (0, import_client.createClient)({
  url: process.env.TURSO_URL,
  authToken: process.env.TURSO_TOKEN ?? ""
});
var DB_PATH = import_path.default.join(process.cwd(), "knesset.db");
var BATCH = 50;
var TAG_LINE_RE = /^<<\s*([^>]+?)\s*>>\s*(.*?)\s*<<[^>]*>>\s*$/;
var TURN_START_TAGS = /* @__PURE__ */ new Set(["\u05D3\u05D5\u05D1\u05E8", "\u05D9\u05D5\u05E8", "\u05E7\u05E8\u05D9\u05D0\u05D4"]);
var CONTINUE_TAGS = /* @__PURE__ */ new Set(["\u05D3\u05D5\u05D1\u05E8_\u05D4\u05DE\u05E9\u05DA"]);
var TOPIC_TAGS = /* @__PURE__ */ new Set(["\u05E0\u05D5\u05E9\u05D0"]);
var HECKLE_NAMES = /* @__PURE__ */ new Set(["\u05E7\u05E8\u05D9\u05D0\u05D4", "\u05E7\u05E8\u05D9\u05D0\u05D5\u05EA", "\u05E8\u05E2\u05E9", "\u05DE\u05D7\u05D9\u05D0\u05D5\u05EA \u05DB\u05E4\u05D9\u05D9\u05DD", "\u05E6\u05D7\u05D5\u05E7"]);
var MINISTER_PREFIX_RE = /^ש(?:ר|רת)\s+ה?[\w\s"״'׳-]{1,20}?\s+(?=[א-ת])/;
function extractNameAndFaction(content) {
  let raw = content.replace(/:$/, "").trim();
  const factionMatch = raw.match(/^(.*?)\s*\(([^)]+)\)\s*$/);
  let faction = null;
  if (factionMatch) {
    raw = factionMatch[1].trim();
    faction = factionMatch[2].trim();
  }
  const prefixes = [
    "\u05D7\u05D1\u05E8\u05EA \u05D4\u05DB\u05E0\u05E1\u05EA ",
    "\u05D7\u05D1\u05E8 \u05D4\u05DB\u05E0\u05E1\u05EA ",
    "\u05E0\u05E9\u05D9\u05D0 \u05D4\u05DE\u05D3\u05D9\u05E0\u05D4 ",
    "\u05E0\u05E9\u05D9\u05D0\u05EA \u05D4\u05DE\u05D3\u05D9\u05E0\u05D4 ",
    "\u05DE\u05D6\u05DB\u05D9\u05E8 \u05D4\u05DB\u05E0\u05E1\u05EA ",
    "\u05DE\u05D6\u05DB\u05D9\u05E8\u05EA \u05D4\u05DB\u05E0\u05E1\u05EA ",
    "\u05E8\u05D0\u05E9 \u05D4\u05DE\u05DE\u05E9\u05DC\u05D4 ",
    "\u05E8\u05D0\u05E9 \u05D4\u05D0\u05D5\u05E4\u05D5\u05D6\u05D9\u05E6\u05D9\u05D4 ",
    "\u05DE\u05DE\u05DC\u05D0 \u05DE\u05E7\u05D5\u05DD \u05E8\u05D0\u05E9 \u05D4\u05DE\u05DE\u05E9\u05DC\u05D4 ",
    '\u05D4\u05D9\u05D5"\u05E8 ',
    "\u05D4\u05D9\u05D5\u05F4\u05E8 ",
    '\u05D9\u05D5"\u05E8 ',
    "\u05D9\u05D5\u05F4\u05E8 ",
    "\u05D4\u05E9\u05E8\u05D4 ",
    "\u05D4\u05E9\u05E8 ",
    '\u05D7"\u05DB ',
    "\u05D7\u05F4\u05DB ",
    "\u05E1\u05D2\u05DF ",
    "\u05E1\u05D2\u05E0\u05D9\u05EA ",
    "\u05D4\u05E8\u05D1 ",
    "\u05E4\u05E8\u05D5\u05E4' ",
    '\u05D3"\u05E8 ',
    "\u05D3\u05F4\u05E8 "
  ];
  for (const prefix of prefixes) {
    if (raw.startsWith(prefix)) {
      raw = raw.slice(prefix.length).trim();
      break;
    }
  }
  const ministerMatch = raw.match(MINISTER_PREFIX_RE);
  if (ministerMatch) {
    raw = raw.slice(ministerMatch[0].length).trim();
  }
  return { name: raw, faction };
}
function classifySpeaker(tag, name, rawContent, mkId) {
  if (!name && !rawContent) return "unknown";
  if (HECKLE_NAMES.has(name) || tag === "\u05E7\u05E8\u05D9\u05D0\u05D4" && !rawContent.endsWith(":")) return "heckle";
  if (mkId !== null) return "mk";
  if (name) return "official";
  return "unknown";
}
function parseTurns(rawText, mkIndex) {
  const lines = rawText.split("\n");
  const turns = [];
  let currentRole = "";
  let currentName = "";
  let currentSpeakerType = "unknown";
  let currentFaction = null;
  let currentMkId = null;
  let currentTopic = null;
  let currentLines = [];
  let turnIndex = 0;
  let sessionChairMkId = null;
  let sessionChairName = "";
  let sessionChairFaction = null;
  const flush = () => {
    const text = currentLines.join("\n").trim();
    if (currentRole && (text || currentSpeakerType === "heckle")) {
      turns.push({
        role: currentRole,
        speakerName: currentName,
        speakerType: currentSpeakerType,
        faction: currentFaction,
        mkId: currentMkId,
        topic: currentTopic,
        text,
        turnIndex: turnIndex++
      });
    }
    currentLines = [];
  };
  const applyIdentity = (name, faction, mkId, tag, rawContent) => {
    currentName = name;
    currentFaction = faction;
    currentMkId = mkId;
    currentSpeakerType = classifySpeaker(tag, name, rawContent, mkId);
    if (tag === "\u05D9\u05D5\u05E8" && mkId) {
      sessionChairMkId = mkId;
      sessionChairName = name;
      sessionChairFaction = faction;
    }
  };
  for (const line of lines) {
    const trimmed = line.trim();
    const tagMatch = trimmed.match(TAG_LINE_RE);
    if (tagMatch) {
      const tag = tagMatch[1].trim();
      const content = tagMatch[2].trim();
      if (TOPIC_TAGS.has(tag)) {
        currentTopic = content.replace(/:$/, "").trim() || null;
      } else if (TURN_START_TAGS.has(tag)) {
        flush();
        currentRole = tag;
        if (content.endsWith(":") && content.length < 120) {
          const { name, faction } = extractNameAndFaction(content);
          const mkId = mkIndex.get(name) ?? null;
          applyIdentity(name, faction, mkId, tag, content);
        } else if (tag === "\u05D9\u05D5\u05E8" && sessionChairMkId) {
          applyIdentity(sessionChairName, sessionChairFaction, sessionChairMkId, tag, "");
          if (content) currentLines.push(content);
        } else if (tag === "\u05E7\u05E8\u05D9\u05D0\u05D4" && content && !content.endsWith(":")) {
          currentName = content.length < 30 ? content : "";
          currentFaction = null;
          currentMkId = null;
          currentSpeakerType = "heckle";
          if (content) currentLines.push(content);
        } else {
          currentName = "";
          currentFaction = null;
          currentMkId = null;
          currentSpeakerType = "unknown";
          if (content) currentLines.push(content);
        }
      } else if (CONTINUE_TAGS.has(tag)) {
        if (content.endsWith(":") && content.length < 120) {
          const { name, faction } = extractNameAndFaction(content);
          const mkId = mkIndex.get(name) ?? null;
          if (mkId && !currentMkId) applyIdentity(name, faction, mkId, tag, content);
        }
      }
    } else {
      const cleaned = trimmed.replace(/<<[^>]*>>/g, "").trim();
      if (currentRole) currentLines.push(cleaned);
    }
  }
  flush();
  return turns;
}
function buildMkIndex() {
  const localDb = new import_better_sqlite3.default(DB_PATH, { readonly: true });
  const mks = localDb.prepare("SELECT person_id, first_name, last_name FROM mk_person").all();
  localDb.close();
  const index = /* @__PURE__ */ new Map();
  const lastNameCount = /* @__PURE__ */ new Map();
  for (const mk of mks) {
    const full = `${mk.first_name} ${mk.last_name}`;
    index.set(full, mk.person_id);
    lastNameCount.set(mk.last_name, (lastNameCount.get(mk.last_name) ?? 0) + 1);
  }
  for (const mk of mks) {
    if ((lastNameCount.get(mk.last_name) ?? 0) === 1) {
      index.set(mk.last_name, mk.person_id);
    }
  }
  return index;
}
async function ensureColumns() {
  const turnCols = ["topic TEXT", "faction TEXT", "speaker_type TEXT"];
  for (const col of turnCols) {
    const [name, type] = col.split(" ");
    try {
      await turso.execute(`ALTER TABLE plenary_speaker_turn ADD COLUMN ${name} ${type}`);
      console.log(`Added column to plenary_speaker_turn: ${name}`);
    } catch {
    }
  }
  try {
    await turso.execute("ALTER TABLE plenary_session ADD COLUMN reparsed_at TEXT");
    console.log("Added column to plenary_session: reparsed_at");
  } catch {
  }
}
async function main() {
  await ensureColumns();
  const mkIndex = buildMkIndex();
  const nextRes = await turso.execute(
    `SELECT id FROM plenary_session WHERE raw_text IS NOT NULL AND reparsed_at IS NULL ORDER BY id ASC LIMIT 1`
  );
  if (nextRes.rows.length === 0) {
    console.log("All plenary sessions reparsed.");
    process.exit(42);
  }
  const sessionId = Number(nextRes.rows[0].id);
  const textRes = await turso.execute({
    sql: "SELECT raw_text FROM plenary_session WHERE id = ?",
    args: [sessionId]
  });
  const rawText = String(textRes.rows[0]?.raw_text ?? "");
  if (!rawText) {
    console.warn(`Session ${sessionId}: no raw_text, skipping`);
    await turso.execute({
      sql: "UPDATE plenary_session SET reparsed_at = ? WHERE id = ?",
      args: [(/* @__PURE__ */ new Date()).toISOString(), sessionId]
    });
    process.exit(0);
  }
  const turns = parseTurns(rawText, mkIndex);
  await turso.execute({
    sql: "DELETE FROM plenary_speaker_turn WHERE session_id = ?",
    args: [sessionId]
  });
  for (let j = 0; j < turns.length; j += BATCH) {
    const slice = turns.slice(j, j + BATCH);
    await turso.batch(slice.map((t) => ({
      sql: `INSERT INTO plenary_speaker_turn
              (session_id, speaker_name, speaker_type, role, faction, mk_id, topic, text, turn_index)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        sessionId,
        t.speakerName,
        t.speakerType,
        t.role,
        t.faction,
        t.mkId,
        t.topic,
        t.text,
        t.turnIndex
      ]
    })), "write");
  }
  await turso.execute({
    sql: "UPDATE plenary_session SET turn_count = ?, reparsed_at = ? WHERE id = ?",
    args: [turns.length, (/* @__PURE__ */ new Date()).toISOString(), sessionId]
  });
  const byType = turns.reduce((acc, t) => {
    acc[t.speakerType] = (acc[t.speakerType] ?? 0) + 1;
    return acc;
  }, {});
  console.log(`Session ${sessionId}: ${turns.length} turns (mk:${byType.mk ?? 0} official:${byType.official ?? 0} heckle:${byType.heckle ?? 0} unknown:${byType.unknown ?? 0})`);
}
main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
