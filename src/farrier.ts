// 修蹄档案的数据模型、日期工具、分组逻辑与本地存储

export type HoofPos = "LF" | "RF" | "LH" | "RH";

export interface HoofEntry {
  /** 蹄形评估 */
  hoofShape: string;
  /** 步态问题，留空表示步态正常 */
  gaitIssue: string;
  /** 蹄铁类型 */
  shoeType: string;
  /** 钉位 */
  nailPositions: string;
  /** 照片 / 备注 */
  photoNote: string;
}

export interface ShoeingRecord {
  id: string;
  /** 马匹编号（统一大写） */
  horseId: string;
  /** 修蹄日期 YYYY-MM-DD */
  date: string;
  /** 下次复查日期 YYYY-MM-DD */
  reviewDate: string;
  /** 本次整体备注 */
  note: string;
  /** 四个蹄位的分别记录，未修整的蹄位缺省 */
  hooves: Partial<Record<HoofPos, HoofEntry>>;
  createdAt: number;
}

export const HOOF_ORDER: HoofPos[] = ["LF", "RF", "LH", "RH"];

export const HOOF_LABEL: Record<HoofPos, string> = {
  LF: "左前蹄",
  RF: "右前蹄",
  LH: "左后蹄",
  RH: "右后蹄",
};

export const HOOF_SHORT: Record<HoofPos, string> = {
  LF: "左前",
  RF: "右前",
  LH: "左后",
  RH: "右后",
};

export const HOOF_KIND: Record<HoofPos, "前蹄" | "后蹄"> = {
  LF: "前蹄",
  RF: "前蹄",
  LH: "后蹄",
  RH: "后蹄",
};

export const SHOE_TYPES = [
  "普通钢蹄铁",
  "铝蹄铁",
  "轻量竞赛铝铁",
  "加护蹄垫",
  "矫形蹄铁",
  "橡胶蹄铁",
  "裸蹄养护",
];

export function emptyHoof(): HoofEntry {
  return { hoofShape: "", gaitIssue: "", shoeType: "", nailPositions: "", photoNote: "" };
}

export function uid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `r-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

// ---------- 日期工具 ----------

export function toDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function todayStr(): string {
  return toDateStr(new Date());
}

/** 在 YYYY-MM-DD 上平移天数 */
export function shiftDate(base: string, days: number): string {
  const d = new Date(`${base}T00:00:00`);
  d.setDate(d.getDate() + days);
  return toDateStr(d);
}

/** from -> to 相差的天数 */
export function diffDays(from: string, to: string): number {
  const a = new Date(`${from}T00:00:00`).getTime();
  const b = new Date(`${to}T00:00:00`).getTime();
  return Math.round((b - a) / 86_400_000);
}

const WEEK_LABEL = ["日", "一", "二", "三", "四", "五", "六"];

export function weekday(s: string): string {
  return `周${WEEK_LABEL[new Date(`${s}T00:00:00`).getDay()]}`;
}

export type ReviewKind = "overdue" | "today" | "soon" | "later";

export interface ReviewStatus {
  kind: ReviewKind;
  /** 距今天的天数，负数表示已逾期 */
  days: number;
}

export function reviewStatus(reviewDate: string, now: string = todayStr()): ReviewStatus | null {
  if (!reviewDate) return null;
  const days = diffDays(now, reviewDate);
  const kind: ReviewKind =
    days < 0 ? "overdue" : days === 0 ? "today" : days <= 7 ? "soon" : "later";
  return { kind, days };
}

// ---------- 分组 / 标记 ----------

export interface HorseGroup {
  horseId: string;
  /** 同一匹马的历次记录，按时间倒序（最近一次在前） */
  records: ShoeingRecord[];
  latest: ShoeingRecord;
}

export function groupByHorse(records: ShoeingRecord[]): HorseGroup[] {
  const map = new Map<string, ShoeingRecord[]>();
  for (const record of records) {
    const list = map.get(record.horseId);
    if (list) list.push(record);
    else map.set(record.horseId, [record]);
  }

  const groups: HorseGroup[] = [];
  for (const [horseId, list] of map) {
    list.sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);
    groups.push({ horseId, records: list, latest: list[0] });
  }
  groups.sort(
    (a, b) =>
      b.latest.date.localeCompare(a.latest.date) || b.latest.createdAt - a.latest.createdAt,
  );
  return groups;
}

export function hoofHasData(entry: HoofEntry | undefined): boolean {
  if (!entry) return false;
  return (
    entry.hoofShape.trim() !== "" ||
    entry.gaitIssue.trim() !== "" ||
    entry.shoeType.trim() !== "" ||
    entry.nailPositions.trim() !== "" ||
    entry.photoNote.trim() !== ""
  );
}

/** 该次记录里被标注步态问题的蹄位 */
export function gaitIssues(record: ShoeingRecord): { pos: HoofPos; text: string }[] {
  const issues: { pos: HoofPos; text: string }[] = [];
  for (const pos of HOOF_ORDER) {
    const text = record.hooves[pos]?.gaitIssue.trim();
    if (text) issues.push({ pos, text });
  }
  return issues;
}

export function hasShoeing(record: ShoeingRecord): boolean {
  return HOOF_ORDER.some((p) => (record.hooves[p]?.shoeType.trim() ?? "") !== "");
}

// ---------- 本地存储 + 示例数据 ----------

const STORAGE_KEY = "farrier-records-v1";

function seedRecord(
  id: string,
  horseId: string,
  dayOffset: number,
  reviewAfterDays: number,
  hooves: Partial<Record<HoofPos, HoofEntry>>,
  note = "",
  seq = 0,
): ShoeingRecord {
  const date = shiftDate(todayStr(), dayOffset);
  return {
    id,
    horseId,
    date,
    reviewDate: shiftDate(date, reviewAfterDays),
    note,
    hooves,
    createdAt: 1_000 + seq,
  };
}

/** 示例数据按“今天”偏移生成，保证复查提醒有逾期 / 临近 / 正常三种状态 */
export function seedRecords(): ShoeingRecord[] {
  return [
    seedRecord(
      "seed-h18-old",
      "HORSE-18",
      -55,
      42,
      {
        LF: {
          hoofShape: "蹄形正常，角度适中",
          gaitIssue: "",
          shoeType: "普通钢蹄铁",
          nailPositions: "内侧 1-2-3，外侧 1-2",
          photoNote: "",
        },
        RF: {
          hoofShape: "外侧壁轻度偏长",
          gaitIssue: "",
          shoeType: "普通钢蹄铁",
          nailPositions: "内侧 1-2-3，外侧 1-2",
          photoNote: "",
        },
      },
      "",
      1,
    ),
    seedRecord(
      "seed-h18-new",
      "HORSE-18",
      -13,
      14,
      {
        LF: {
          hoofShape: "蹄形正常",
          gaitIssue: "",
          shoeType: "铝蹄铁",
          nailPositions: "内侧 1-2-3，外侧 1-2",
          photoNote: "",
        },
        RF: {
          hoofShape: "右前外侧壁偏长、磨耗明显，蹄叉轻度萎缩",
          gaitIssue: "快步时右前略向外偏，硬地外侧磨耗",
          shoeType: "铝蹄铁",
          nailPositions: "内侧 1-2，外侧 1-2-3",
          photoNote: "右前外侧角度特写 IMG_0302，复查对比用",
        },
      },
      "换轻铝铁观察步态，两周后复查",
      2,
    ),
    seedRecord(
      "seed-h27",
      "HORSE-27",
      -34,
      26,
      {
        LH: {
          hoofShape: "左后蹄尖纵裂约 1.5cm，未达蹄叉",
          gaitIssue: "",
          shoeType: "加护蹄垫",
          nailPositions: "内侧 1-2，外侧 1-2（避开裂纹）",
          photoNote: "裂纹长度特写 IMG_0310",
        },
        RH: {
          hoofShape: "蹄形正常，蹄壁略干",
          gaitIssue: "",
          shoeType: "加护蹄垫",
          nailPositions: "内侧 1-2-3，外侧 1-2",
          photoNote: "",
        },
      },
      "后蹄上护垫减少裂纹受力",
      3,
    ),
    seedRecord(
      "seed-h04-old",
      "HORSE-04",
      -70,
      42,
      {
        LF: { hoofShape: "正常", gaitIssue: "", shoeType: "普通钢蹄铁", nailPositions: "内 1-2-3，外 1-2", photoNote: "" },
        RF: { hoofShape: "正常", gaitIssue: "", shoeType: "普通钢蹄铁", nailPositions: "内 1-2-3，外 1-2", photoNote: "" },
        LH: { hoofShape: "正常", gaitIssue: "", shoeType: "普通钢蹄铁", nailPositions: "内 1-2，外 1-2", photoNote: "" },
        RH: { hoofShape: "正常", gaitIssue: "", shoeType: "普通钢蹄铁", nailPositions: "内 1-2，外 1-2", photoNote: "" },
      },
      "",
      4,
    ),
    seedRecord(
      "seed-h04-new",
      "HORSE-04",
      -28,
      42,
      {
        LF: { hoofShape: "正常", gaitIssue: "", shoeType: "普通钢蹄铁", nailPositions: "内 1-2-3，外 1-2", photoNote: "" },
        RF: { hoofShape: "正常", gaitIssue: "", shoeType: "普通钢蹄铁", nailPositions: "内 1-2-3，外 1-2", photoNote: "" },
        LH: { hoofShape: "正常", gaitIssue: "", shoeType: "普通钢蹄铁", nailPositions: "内 1-2，外 1-2", photoNote: "" },
        RH: { hoofShape: "正常", gaitIssue: "", shoeType: "普通钢蹄铁", nailPositions: "内 1-2，外 1-2", photoNote: "" },
      },
      "",
      5,
    ),
    seedRecord(
      "seed-h31",
      "HORSE-31",
      -5,
      8,
      {
        LF: {
          hoofShape: "左前蹄角度略陡，落蹄稍重",
          gaitIssue: "运步轻微不稳、左前着地略迟，硬地明显，需教练复核",
          shoeType: "普通钢蹄铁",
          nailPositions: "内侧 1-2-3，外侧 1-2",
          photoNote: "硬地慢步视频已同步教练",
        },
        RF: { hoofShape: "正常", gaitIssue: "", shoeType: "普通钢蹄铁", nailPositions: "内侧 1-2-3，外侧 1-2", photoNote: "" },
        LH: { hoofShape: "正常", gaitIssue: "", shoeType: "普通钢蹄铁", nailPositions: "内侧 1-2，外侧 1-2", photoNote: "" },
        RH: { hoofShape: "正常", gaitIssue: "", shoeType: "普通钢蹄铁", nailPositions: "内侧 1-2，外侧 1-2", photoNote: "" },
      },
      "步态异常，复查前减少硬地训练",
      6,
    ),
  ];
}

export function loadRecords(): ShoeingRecord[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as ShoeingRecord[];
      if (Array.isArray(parsed)) return parsed;
    }
  } catch {
    // 本地存储不可用时退回示例数据（仅本次会话有效）
  }
  return seedRecords();
}

export function persistRecords(records: ShoeingRecord[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
  } catch {
    // 忽略写入失败（隐私模式等）
  }
}
