// 修蹄档案的数据模型、日期工具、汇总逻辑与本地存储

export type HoofPosition = "LF" | "RF" | "LH" | "RH";

export interface PositionMeta {
  value: HoofPosition;
  label: string; // 左前蹄
  short: string; // 左前
  limb: "前蹄" | "后蹄";
}

export const POSITIONS: PositionMeta[] = [
  { value: "LF", label: "左前蹄", short: "左前", limb: "前蹄" },
  { value: "RF", label: "右前蹄", short: "右前", limb: "前蹄" },
  { value: "LH", label: "左后蹄", short: "左后", limb: "后蹄" },
  { value: "RH", label: "右后蹄", short: "右后", limb: "后蹄" },
];

export const POSITION_MAP: Record<HoofPosition, PositionMeta> = POSITIONS.reduce(
  (acc, p) => {
    acc[p.value] = p;
    return acc;
  },
  {} as Record<HoofPosition, PositionMeta>
);

/** 单个蹄位的一次修整记录 */
export interface HoofEntry {
  position: HoofPosition;
  hoofShape: string; // 蹄形评估
  gaitIssue: string; // 步态问题，留空表示步态正常
  shoeType: string; // 蹄铁类型
  nailPattern: string; // 钉位
  photoNote: string; // 照片备注
  photoName?: string;
  photoData?: string; // 压缩后的照片 dataURL
}

/** 一次修蹄/换蹄铁作业（可同时处理多个蹄位） */
export interface TrimmingRecord {
  id: string;
  horseId: string;
  date: string; // 修蹄日期 YYYY-MM-DD
  recheckDate: string; // 复查日期 YYYY-MM-DD
  note: string;
  hooves: HoofEntry[];
  createdAt: number;
}

export interface HoofDraft extends HoofEntry {
  localId: string;
}

/** 同一匹马的档案：历次更换按时间倒序排在一起 */
export interface HorseSummary {
  horseId: string;
  latest: TrimmingRecord;
  records: TrimmingRecord[]; // 按时间倒序
  abnormal: boolean; // 最近一次记录中是否存在异常步态
  recheckDiff: number; // 距下次复查的天数（负=已逾期）
}

// ---------- 日期工具 ----------

export function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function todayISO(): string {
  return toISODate(new Date());
}

export function offsetDate(base: string, days: number): string {
  const d = new Date((base || todayISO()) + "T00:00:00");
  d.setDate(d.getDate() + days);
  return toISODate(d);
}

export function daysBetween(a: string, b: string): number {
  const ms = new Date(b + "T00:00:00").getTime() - new Date(a + "T00:00:00").getTime();
  return Math.round(ms / 86400000);
}

export function formatCN(iso: string): string {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-");
  return `${y}年${Number(m)}月${Number(d)}日`;
}

export type RecheckTone = "overdue" | "today" | "soon" | "later";

export interface RecheckStatus {
  tone: RecheckTone;
  label: string;
  diff: number;
}

export function recheckStatus(recheckDate: string): RecheckStatus {
  const diff = daysBetween(todayISO(), recheckDate);
  if (diff < 0) return { tone: "overdue", label: `已逾期 ${-diff} 天`, diff };
  if (diff === 0) return { tone: "today", label: "今日复查", diff };
  if (diff <= 7) return { tone: "soon", label: `${diff} 天后复查`, diff };
  return { tone: "later", label: `${diff} 天后复查`, diff };
}

// ---------- 汇总 ----------

export function isAbnormalRecord(r: TrimmingRecord): boolean {
  return r.hooves.some((h) => h.gaitIssue.trim() !== "");
}

export function normalizeHorseId(id: string): string {
  return id.trim().toUpperCase();
}

export function summarize(records: TrimmingRecord[]): HorseSummary[] {
  const groups = new Map<string, TrimmingRecord[]>();
  for (const r of records) {
    const id = normalizeHorseId(r.horseId);
    const list = groups.get(id);
    if (list) list.push(r);
    else groups.set(id, [r]);
  }

  const result: HorseSummary[] = [];
  for (const [horseId, list] of groups) {
    const sorted = [...list].sort((a, b) =>
      a.date === b.date ? b.createdAt - a.createdAt : b.date.localeCompare(a.date)
    );
    const latest = sorted[0];
    result.push({
      horseId,
      latest,
      records: sorted,
      abnormal: isAbnormalRecord(latest),
      recheckDiff: recheckStatus(latest.recheckDate).diff,
    });
  }

  // 列表默认：最近修蹄的马在前
  result.sort((a, b) =>
    a.latest.date === b.latest.date
      ? b.latest.createdAt - a.latest.createdAt
      : b.latest.date.localeCompare(a.latest.date)
  );
  return result;
}

export function uid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `r-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

// ---------- 下拉候选 ----------

export const HOOF_SHAPE_OPTIONS = [
  "正常",
  "蹄尖偏长",
  "蹄壁外侧偏长",
  "蹄壁内侧偏长",
  "扁平蹄",
  "蹄底轻度扁平",
  "外向蹄（外弧）",
  "内向蹄（内弧）",
  "浅表蹄裂",
  "崩蹄/缺角",
  "蹄跟萎缩",
  "广角蹄",
];

export const SHOE_TYPE_OPTIONS = [
  "普通钢蹄铁",
  "铝合金蹄铁",
  "橡胶蹄铁",
  "塑料蹄铁",
  "护蹄垫＋钢蹄铁",
  "矫正蹄铁",
  "开放式蹄铁",
  "裸蹄修整（不挂铁）",
];

export const NAIL_PATTERN_PRESETS = [
  "内侧1-3、外侧1-4",
  "内侧1-3、外侧1-3",
  "内侧1-2、外侧1-2",
];

// ---------- CSV 导出 ----------

function csvCell(v: string): string {
  const s = (v ?? "").replace(/"/g, '""');
  return /[",\n]/.test(s) ? `"${s}"` : s;
}

export function toCSV(records: TrimmingRecord[]): string {
  const header = [
    "马匹编号",
    "修蹄日期",
    "复查日期",
    "蹄位",
    "蹄形评估",
    "步态问题",
    "蹄铁类型",
    "钉位",
    "照片备注",
    "作业备注",
  ];
  const lines: string[] = [header.map(csvCell).join(",")];
  const sorted = [...records].sort((a, b) =>
    a.horseId === b.horseId ? a.date.localeCompare(b.date) : a.horseId.localeCompare(b.horseId)
  );
  for (const r of sorted) {
    const hooves = r.hooves.length ? r.hooves : [null];
    hooves.forEach((h, i) => {
      lines.push(
        [
          i === 0 ? r.horseId : "",
          i === 0 ? r.date : "",
          i === 0 ? r.recheckDate : "",
          h ? POSITION_MAP[h.position].label : "",
          h?.hoofShape ?? "",
          h?.gaitIssue ?? "",
          h?.shoeType ?? "",
          h?.nailPattern ?? "",
          h?.photoNote ?? "",
          i === 0 ? r.note : "",
        ]
          .map(csvCell)
          .join(",")
      );
    });
  }
  return "\uFEFF" + lines.join("\n"); // BOM，Excel 打开不乱码
}

// ---------- 图片压缩 ----------

export function fileToThumb(file: File): Promise<{ dataUrl: string; name: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const MAX = 900;
        let w = img.width;
        let h = img.height;
        if (w > MAX || h > MAX) {
          const scale = Math.min(MAX / w, MAX / h);
          w = Math.round(w * scale);
          h = Math.round(h * scale);
        }
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          reject(new Error("图片处理失败"));
          return;
        }
        ctx.drawImage(img, 0, 0, w, h);
        resolve({ dataUrl: canvas.toDataURL("image/jpeg", 0.72), name: file.name });
      };
      img.onerror = () => reject(new Error("图片读取失败"));
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

// ---------- 本地存储 + 示例数据 ----------

const STORAGE_KEY = "farrier-records-v1";

function seedRecords(): TrimmingRecord[] {
  const d = (offset: number) => offsetDate(todayISO(), offset);
  let seq = 0;
  const ts = () => Date.now() - 10_000_000 + seq++;

  return [
    {
      id: uid(),
      horseId: "HORSE-18",
      date: d(-46),
      recheckDate: d(-4),
      note: "常规六周更换，右前外磨待观察。",
      createdAt: ts(),
      hooves: [
        {
          position: "LF",
          hoofShape: "正常",
          gaitIssue: "",
          shoeType: "普通钢蹄铁",
          nailPattern: "内侧1-3、外侧1-4",
          photoNote: "",
        },
        {
          position: "RF",
          hoofShape: "外侧壁轻度偏长",
          gaitIssue: "外侧磨耗（轻度）",
          shoeType: "普通钢蹄铁",
          nailPattern: "内侧1-3、外侧1-4",
          photoNote: "",
        },
      ],
    },
    {
      id: uid(),
      horseId: "HORSE-18",
      date: d(-4),
      recheckDate: d(10),
      note: "右前减钉并补焊外侧，两周后复查步态与磨耗。",
      createdAt: ts(),
      hooves: [
        {
          position: "LF",
          hoofShape: "正常，角度良好",
          gaitIssue: "",
          shoeType: "铝合金蹄铁",
          nailPattern: "内侧1-3、外侧1-4",
          photoNote: "",
        },
        {
          position: "RF",
          hoofShape: "外侧壁磨损、蹄底轻度扁平",
          gaitIssue: "外侧磨耗明显，落地偏外",
          shoeType: "铝合金蹄铁（外侧补焊）",
          nailPattern: "内侧1-2、外侧1-3（外侧减钉）",
          photoNote: "右前蹄底面、外侧壁特写各一张",
        },
      ],
    },
    {
      id: uid(),
      horseId: "HORSE-27",
      date: d(-60),
      recheckDate: d(-32),
      note: "例行更换。",
      createdAt: ts(),
      hooves: [
        {
          position: "LH",
          hoofShape: "正常",
          gaitIssue: "",
          shoeType: "普通钢蹄铁",
          nailPattern: "内侧1-3、外侧1-3",
          photoNote: "",
        },
        {
          position: "RH",
          hoofShape: "正常",
          gaitIssue: "",
          shoeType: "普通钢蹄铁",
          nailPattern: "内侧1-3、外侧1-3",
          photoNote: "",
        },
      ],
    },
    {
      id: uid(),
      horseId: "HORSE-27",
      date: d(-12),
      recheckDate: d(2),
      note: "后蹄加护蹄垫，两周复查裂纹愈合情况。",
      createdAt: ts(),
      hooves: [
        {
          position: "LH",
          hoofShape: "左后蹄跟浅表纵裂",
          gaitIssue: "",
          shoeType: "护蹄垫＋钢蹄铁",
          nailPattern: "内侧1-2、外侧1-2（避开裂线）",
          photoNote: "蹄跟裂纹局部特写",
        },
        {
          position: "RH",
          hoofShape: "轻度蹄壁干燥",
          gaitIssue: "",
          shoeType: "护蹄垫＋钢蹄铁",
          nailPattern: "内侧1-3、外侧1-3",
          photoNote: "",
        },
      ],
    },
    {
      id: uid(),
      horseId: "HORSE-31",
      date: d(-75),
      recheckDate: d(-47),
      note: "例行更换。",
      createdAt: ts(),
      hooves: [
        {
          position: "LF",
          hoofShape: "正常",
          gaitIssue: "",
          shoeType: "普通钢蹄铁",
          nailPattern: "内侧1-3、外侧1-4",
          photoNote: "",
        },
        {
          position: "RF",
          hoofShape: "正常",
          gaitIssue: "",
          shoeType: "普通钢蹄铁",
          nailPattern: "内侧1-3、外侧1-4",
          photoNote: "",
        },
      ],
    },
    {
      id: uid(),
      horseId: "HORSE-31",
      date: d(-20),
      recheckDate: d(-6),
      note: "调整左前角度，步态异常需教练一起复核。",
      createdAt: ts(),
      hooves: [
        {
          position: "LF",
          hoofShape: "左前蹄尖偏长、角度偏陡",
          gaitIssue: "运步轻微不稳，左转时明显",
          shoeType: "开放式蹄铁",
          nailPattern: "内侧1-3、外侧1-4",
          photoNote: "左前蹄侧面角度照",
        },
        {
          position: "RF",
          hoofShape: "轻度偏长",
          gaitIssue: "",
          shoeType: "普通钢蹄铁",
          nailPattern: "内侧1-3、外侧1-4",
          photoNote: "",
        },
      ],
    },
    {
      id: uid(),
      horseId: "HORSE-09",
      date: d(-8),
      recheckDate: d(34),
      note: "六周周期例行修整，四蹄状态良好。",
      createdAt: ts(),
      hooves: POSITIONS.map((p, i) => ({
        position: p.value,
        hoofShape: "正常",
        gaitIssue: "",
        shoeType: "普通钢蹄铁",
        nailPattern: i < 2 ? "内侧1-3、外侧1-4" : "内侧1-3、外侧1-3",
        photoNote: "",
      })),
    },
  ];
}

export function loadRecords(): TrimmingRecord[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed as TrimmingRecord[];
    }
  } catch {
    // 存储损坏时回退到示例数据
  }
  const seed = seedRecords();
  persistRecords(seed);
  return seed;
}

export function persistRecords(records: TrimmingRecord[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
  } catch {
    // 照片过大等导致配额不足时，仅本次会话有效
  }
}
