import { useEffect, useMemo, useRef, useState } from "react";
import "./styles.css";
import {
  diffDays,
  emptyHoof,
  gaitIssues,
  groupByHorse,
  hasShoeing,
  hoofHasData,
  HOOF_KIND,
  HOOF_LABEL,
  HOOF_ORDER,
  HOOF_SHORT,
  loadRecords,
  persistRecords,
  reviewStatus,
  seedRecords,
  SHOE_TYPES,
  shiftDate,
  todayStr,
  uid,
  weekday,
  type HoofEntry,
  type HoofPos,
  type HorseGroup,
  type ReviewKind,
  type ShoeingRecord,
} from "./farrier";

type FilterKey = "all" | "gait" | "due" | "front" | "hind";

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: "all", label: "全部马匹" },
  { key: "gait", label: "异常步态" },
  { key: "due", label: "待复查（7天内/逾期）" },
  { key: "front", label: "前蹄问题" },
  { key: "hind", label: "后蹄问题" },
];

const REVIEW_TEXT: Record<ReviewKind, string> = {
  overdue: "已逾期",
  today: "今天复查",
  soon: "临近复查",
  later: "复查正常",
};

function reviewText(reviewDate: string): string {
  const status = reviewStatus(reviewDate);
  if (!status) return "";
  const { kind, days } = status;
  if (kind === "overdue") return `逾期 ${Math.abs(days)} 天`;
  if (kind === "today") return "今天复查";
  return `${days} 天后`;
}

// ---------- 蹄位展示 ----------

function HoofView({ pos, hoof }: { pos: HoofPos; hoof: HoofEntry }) {
  return (
    <div className="hoof-card">
      <header>
        <span className={`hoof-tag ${HOOF_KIND[pos] === "前蹄" ? "hoof-front" : "hoof-hind"}`}>{HOOF_LABEL[pos]}</span>
        {hoof.gaitIssue.trim() && <span className="gait-badge">异常步态</span>}
      </header>
      <dl>
        <div>
          <dt>蹄形</dt>
          <dd>{hoof.hoofShape || "—"}</dd>
        </div>
        <div className={hoof.gaitIssue.trim() ? "danger" : ""}>
          <dt>步态问题</dt>
          <dd>{hoof.gaitIssue || "无"}</dd>
        </div>
        <div>
          <dt>蹄铁类型</dt>
          <dd>{hoof.shoeType || "未装蹄铁"}</dd>
        </div>
        <div>
          <dt>钉位</dt>
          <dd className="nail-pos">{hoof.nailPositions || "—"}</dd>
        </div>
        {hoof.photoNote.trim() && (
          <div className="photo-note">
            <dt>照片 / 备注</dt>
            <dd>{hoof.photoNote}</dd>
          </div>
        )}
      </dl>
    </div>
  );
}

function RecordView({
  record,
  index,
  onDelete,
}: {
  record: ShoeingRecord;
  index: number;
  onDelete: (id: string) => void;
}) {
  const issues = gaitIssues(record);
  const edited = HOOF_ORDER.map((p) => record.hooves[p]).filter(hoofHasData).length;
  return (
    <article className={`visit ${index === 0 ? "latest" : ""}`}>
      <div className="visit-head">
        <div className="visit-date">
          <b>{record.date}</b>
          <span>{weekday(record.date)}</span>
          {index === 0 && <em className="latest-tag">最近一次</em>}
        </div>
        <div className="visit-meta">
          <span>修整 {edited} 个蹄位</span>
          {issues.length > 0 && (
            <span className="gait-badge">
              异常步态：{issues.map((i) => HOOF_SHORT[i.pos]).join("、")}
            </span>
          )}
          <button type="button" className="delete-btn" onClick={() => onDelete(record.id)}>
            删除本次
          </button>
        </div>
      </div>
      <div className="hoof-grid">
        {HOOF_ORDER.filter((p) => hoofHasData(record.hooves[p])).map((p) => (
          <HoofView key={p} pos={p} hoof={record.hooves[p] as HoofEntry} />
        ))}
      </div>
      <div className="visit-foot">
        <span>复查日期：{record.reviewDate}（{weekday(record.reviewDate)}）</span>
        {record.note.trim() && <span className="visit-note">整体备注：{record.note}</span>}
      </div>
    </article>
  );
}

// ---------- 马匹卡片 ----------

function HorseCard({
  group,
  expanded,
  onToggle,
  onDeleteRecord,
  registerRef,
}: {
  group: HorseGroup;
  expanded: boolean;
  onToggle: () => void;
  onDeleteRecord: (id: string) => void;
  registerRef: (el: HTMLElement | null) => void;
}) {
  const { horseId, records, latest } = group;
  const issues = gaitIssues(latest);
  const abnormal = issues.length > 0;
  const status = reviewStatus(latest.reviewDate);
  const daysSince = diffDays(latest.date, todayStr());

  return (
    <article
      ref={registerRef}
      className={`horse-card${abnormal ? " abnormal" : ""}${expanded ? " open" : ""}`}
    >
      <button type="button" className="horse-head" onClick={onToggle}>
        <span className="horse-id">{horseId}</span>
        <span className="horse-sum">
          共 {records.length} 次修蹄 · 最近 {daysSince === 0 ? "今天" : `${daysSince} 天前`}（
          {latest.date}）
        </span>
        <span className="horse-badges">
          {abnormal && (
            <span className="gait-badge strong">
              异常步态 {issues.map((i) => HOOF_SHORT[i.pos]).join("/")}：{issues[0].text}
            </span>
          )}
          {status && <span className={`review-chip ${status.kind}`}>{REVIEW_TEXT[status.kind]} · {reviewText(latest.reviewDate)}</span>}
          <span className="caret" aria-hidden>
            {expanded ? "收起 ▲" : "展开历次 ▼"}
          </span>
        </span>
      </button>

      {expanded && (
        <div className="horse-body">
          {records.map((record, i) => (
            <RecordView key={record.id} record={record} index={i} onDelete={onDeleteRecord} />
          ))}
        </div>
      )}
    </article>
  );
}

// ---------- 表单中的单蹄块 ----------

function HoofForm({
  pos,
  enabled,
  hoof,
  onToggle,
  onChange,
}: {
  pos: HoofPos;
  enabled: boolean;
  hoof: HoofEntry;
  onToggle: (enabled: boolean) => void;
  onChange: (next: HoofEntry) => void;
}) {
  const set = (key: keyof HoofEntry, value: string) => onChange({ ...hoof, [key]: value });

  return (
    <section className={`hoof-form ${enabled ? "" : "off"} ${HOOF_KIND[pos] === "前蹄" ? "hoof-kind-front" : "hoof-kind-hind"}`}>
      <header>
        <label className="hoof-enable">
          <input type="checkbox" checked={enabled} onChange={(e) => onToggle(e.target.checked)} />
          <span className={`hoof-tag ${HOOF_KIND[pos] === "前蹄" ? "hoof-front" : "hoof-hind"}`}>{HOOF_LABEL[pos]}</span>
        </label>
        {enabled && hoof.gaitIssue.trim() !== "" && <span className="gait-badge">已标记异常</span>}
      </header>
      {enabled && (
        <div className="hoof-form-body">
          <label>
            <span>蹄形评估</span>
            <input value={hoof.hoofShape} onChange={(e) => set("hoofShape", e.target.value)} placeholder="如：外侧壁偏长、角度偏陡" />
          </label>
          <label className={hoof.gaitIssue.trim() !== "" ? "danger-label" : ""}>
            <span>步态问题（留空＝正常）</span>
            <input
              value={hoof.gaitIssue}
              onChange={(e) => set("gaitIssue", e.target.value)}
              placeholder="如：右前外侧磨耗、运步不稳"
            />
          </label>
          <label>
            <span>蹄铁类型</span>
            <input
              list="shoe-type-list"
              value={hoof.shoeType}
              onChange={(e) => set("shoeType", e.target.value)}
              placeholder="选择或输入蹄铁类型"
            />
          </label>
          <label>
            <span>钉位</span>
            <input
              value={hoof.nailPositions}
              onChange={(e) => set("nailPositions", e.target.value)}
              placeholder="如：内侧 1-2-3，外侧 1-2"
            />
          </label>
          <label className="full">
            <span>照片 / 备注（照片编号、角度、对比说明）</span>
            <textarea
              rows={2}
              value={hoof.photoNote}
              onChange={(e) => set("photoNote", e.target.value)}
              placeholder="如：右前外侧角度特写 IMG_0302"
            />
          </label>
        </div>
      )}
    </section>
  );
}

// ---------- 主应用 ----------

function App() {
  const [records, setRecords] = useState<ShoeingRecord[]>(() => loadRecords());

  // 表单
  const [horseId, setHorseId] = useState("");
  const [date, setDate] = useState(todayStr());
  const [reviewDate, setReviewDate] = useState(shiftDate(todayStr(), 35));
  const [note, setNote] = useState("");
  const [enabled, setEnabled] = useState<Record<HoofPos, boolean>>({
    LF: true,
    RF: true,
    LH: false,
    RH: false,
  });
  const [hooves, setHooves] = useState<Record<HoofPos, HoofEntry>>({
    LF: emptyHoof(),
    RF: emptyHoof(),
    LH: emptyHoof(),
    RH: emptyHoof(),
  });
  const [formError, setFormError] = useState("");
  const [conflict, setConflict] = useState<{ latest: ShoeingRecord } | null>(null);

  // 列表
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<FilterKey>("all");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState("");
  const cardRefs = useRef(new Map<string, HTMLElement>());

  useEffect(() => {
    persistRecords(records);
  }, [records]);

  const groups = useMemo(() => groupByHorse(records), [records]);
  const knownIds = useMemo(() => groups.map((g) => g.horseId), [groups]);

  const now = todayStr();

  // 指标
  const abnormalSet = useMemo(
    () => new Set(groups.filter((g) => gaitIssues(g.latest).length > 0).map((g) => g.horseId)),
    [groups],
  );
  const dueGroups = useMemo(
    () =>
      groups.filter((g) => {
        const s = reviewStatus(g.latest.reviewDate);
        return s !== null && s.kind !== "later";
      }),
    [groups],
  );
  const metrics = {
    due: dueGroups.length,
    gait: abnormalSet.size,
    shoeing: records.filter(hasShoeing).length,
    horses: groups.length,
  };

  // 过滤
  const filtered = useMemo(() => {
    const q = query.trim().toUpperCase();
    return groups.filter((g) => {
      if (q && !g.horseId.includes(q)) return false;
      const latest = g.latest;
      const s = reviewStatus(latest.reviewDate);
      switch (filter) {
        case "gait":
          return gaitIssues(latest).length > 0;
        case "due":
          return s !== null && s.kind !== "later";
        case "front":
          return HOOF_ORDER.some(
            (p) => HOOF_KIND[p] === "前蹄" && (hoofHasData(latest.hooves[p]) && (latest.hooves[p]!.gaitIssue.trim() !== "" || latest.hooves[p]!.hoofShape.trim() !== "")),
          );
        case "hind":
          return HOOF_ORDER.some(
            (p) => HOOF_KIND[p] === "后蹄" && (hoofHasData(latest.hooves[p]) && (latest.hooves[p]!.gaitIssue.trim() !== "" || latest.hooves[p]!.hoofShape.trim() !== "")),
          );
        default:
          return true;
      }
    });
  }, [groups, query, filter]);

  // 复查提醒：异常步态优先，其次逾期/临近，按复查日期升序
  const reminders = useMemo(() => {
    return [...dueGroups].sort((a, b) => {
      const ga = gaitIssues(a.latest).length > 0 ? 0 : 1;
      const gb = gaitIssues(b.latest).length > 0 ? 0 : 1;
      if (ga !== gb) return ga - gb;
      return a.latest.reviewDate.localeCompare(b.latest.reviewDate);
    });
  }, [dueGroups]);

  // ---------- 保存 ----------

  const buildRecord = (): ShoeingRecord => ({
    id: uid(),
    horseId: horseId.trim().toUpperCase(),
    date,
    reviewDate,
    note: note.trim(),
    hooves: HOOF_ORDER.reduce<Partial<Record<HoofPos, HoofEntry>>>((acc, pos) => {
      if (enabled[pos] && hoofHasData(hooves[pos])) acc[pos] = { ...hooves[pos] };
      return acc;
    }, {}),
    createdAt: Date.now(),
  });

  const validate = (): string => {
    if (!horseId.trim()) return "请填写马匹编号。";
    if (!date) return "请选择修蹄日期。";
    if (!reviewDate) return "请选择下次复查日期。";
    if (reviewDate < date) return "复查日期不能早于修蹄日期。";
    const anyHoof = HOOF_ORDER.some((p) => enabled[p] && hoofHasData(hooves[p]));
    if (!anyHoof) return "请至少勾选并填写一个蹄位（蹄形 / 步态 / 蹄铁 / 钉位 / 备注任意一项）。";
    return "";
  };

  const doSave = (override: boolean) => {
    const error = validate();
    if (error) {
      setFormError(error);
      return;
    }
    const id = horseId.trim().toUpperCase();
    const own = records.filter((r) => r.horseId === id);
    const latest = own
      .slice()
      .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt)[0];

    if (!override && latest && date < latest.date) {
      // 日期冲突：先提示，不写入，原记录原样保留
      setFormError("");
      setConflict({ latest });
      return;
    }

    const record = buildRecord();
    setRecords((prev) => [...prev, record]);

    // 重置表单（保留编号方便连录同马），展开该马档案
    setDate(todayStr());
    setReviewDate(shiftDate(todayStr(), 35));
    setNote("");
    setHooves({ LF: emptyHoof(), RF: emptyHoof(), LH: emptyHoof(), RH: emptyHoof() });
    setEnabled({ LF: true, RF: true, LH: false, RH: false });
    setFormError("");
    setConflict(null);
    setExpanded((prev) => new Set(prev).add(id));
    setFilter("all");
    setQuery("");
    setToast(`已保存 ${id} 的修蹄记录（${record.date}）`);
    window.setTimeout(() => {
      cardRefs.current.get(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 80);
  };

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(""), 2600);
    return () => window.clearTimeout(t);
  }, [toast]);

  const deleteRecord = (recordId: string) => {
    const target = records.find((r) => r.id === recordId);
    if (!target) return;
    if (!window.confirm(`确定删除 ${target.horseId} 在 ${target.date} 的修蹄记录吗？此操作不可恢复。`)) return;
    setRecords((prev) => prev.filter((r) => r.id !== recordId));
  };

  const jumpToHorse = (id: string) => {
    setExpanded((prev) => new Set(prev).add(id));
    window.setTimeout(() => {
      cardRefs.current.get(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 60);
  };

  const resetDemo = () => {
    if (!window.confirm("将清空当前全部记录并恢复示例档案，确定吗？")) return;
    setRecords(seedRecords());
    setToast("已恢复示例档案");
  };

  const exportCsv = () => {
    const header = [
      "马匹编号", "修蹄日期", "复查日期", "蹄位", "蹄形", "步态问题", "蹄铁类型", "钉位", "照片备注", "整体备注",
    ];
    const lines = [header.join(",")];
    const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
    for (const g of groupByHorse(records)) {
      for (const r of g.records) {
        for (const pos of HOOF_ORDER) {
          const h = r.hooves[pos];
          if (!hoofHasData(h)) continue;
          lines.push(
            [g.horseId, r.date, r.reviewDate, HOOF_LABEL[pos], h!.hoofShape, h!.gaitIssue, h!.shoeType, h!.nailPositions, h!.photoNote, r.note]
              .map(esc)
              .join(","),
          );
        }
      }
    }
    const blob = new Blob(["﻿" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `修蹄档案_${todayStr()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const toggleHorse = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const filterCounts: Record<FilterKey, number> = {
    all: groups.length,
    gait: groups.filter((g) => gaitIssues(g.latest).length > 0).length,
    due: dueGroups.length,
    front: groups.filter((g) =>
      HOOF_ORDER.some((p) => HOOF_KIND[p] === "前蹄" && hoofHasData(g.latest.hooves[p]) && (g.latest.hooves[p]!.gaitIssue.trim() !== "" || g.latest.hooves[p]!.hoofShape.trim() !== "")),
    ).length,
    hind: groups.filter((g) =>
      HOOF_ORDER.some((p) => HOOF_KIND[p] === "后蹄" && hoofHasData(g.latest.hooves[p]) && (g.latest.hooves[p]!.gaitIssue.trim() !== "" || g.latest.hooves[p]!.hoofShape.trim() !== "")),
    ).length,
  };

  return (
    <main className="app">
      <datalist id="shoe-type-list">
        {SHOE_TYPES.map((t) => (
          <option key={t} value={t} />
        ))}
      </datalist>
      <datalist id="horse-id-list">
        {knownIds.map((id) => (
          <option key={id} value={id} />
        ))}
      </datalist>

      <section className="hero">
        <p>马术蹄铁修整档案 · 数据保存在本机浏览器</p>
        <h1>蹄铁师修蹄档案</h1>
        <span>
          按马匹编号登记每次修蹄：四个蹄位分别记录蹄形、步态、蹄铁类型、钉位与照片备注；
          同一匹马的历次更换按时间倒序排在一起，异常步态与复查到期一目了然。
        </span>
      </section>

      <section className="metrics">
        <article>
          <small>待复查（逾期/7天内）</small>
          <strong className={metrics.due > 0 ? "warn" : ""}>{metrics.due}</strong>
        </article>
        <article>
          <small>异常步态马匹</small>
          <strong className={metrics.gait > 0 ? "danger" : ""}>{metrics.gait}</strong>
        </article>
        <article>
          <small>累计更换蹄铁次数</small>
          <strong>{metrics.shoeing}</strong>
        </article>
        <article>
          <small>马匹档案</small>
          <strong>{metrics.horses}</strong>
        </article>
      </section>

      {/* 复查提醒 */}
      <section className="panel reminders">
        <div className="heading">
          <div>
            <p>复查提醒</p>
            <h2>到期与临近复查{reminders.length > 0 && `（${reminders.length}）`}</h2>
          </div>
          <span className="hint">异常步态的马排在最前，点击直接跳到档案</span>
        </div>
        {reminders.length === 0 ? (
          <p className="empty">近期没有需要复查的马。</p>
        ) : (
          <ul className="reminder-list">
            {reminders.map((g) => {
              const s = reviewStatus(g.latest.reviewDate)!;
              const abnormal = gaitIssues(g.latest).length > 0;
              return (
                <li key={g.horseId} className={abnormal ? "abnormal" : ""}>
                  <button type="button" onClick={() => jumpToHorse(g.horseId)}>
                    <b>{g.horseId}</b>
                    {abnormal && <span className="gait-badge strong">异常步态</span>}
                    <span className={`review-chip ${s.kind}`}>
                      {REVIEW_TEXT[s.kind]} · {reviewText(g.latest.reviewDate)}
                    </span>
                    <span className="reminder-date">
                      复查 {g.latest.reviewDate}（{weekday(g.latest.reviewDate)}） · 上次修蹄 {g.latest.date}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="workspace">
        <aside className="panel">
          <h2>马匹筛选</h2>
          <input
            className="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="按马匹编号搜索…"
          />
          <div className="chips vertical">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                className={filter === f.key ? "active" : ""}
                onClick={() => setFilter(f.key)}
              >
                {f.label}
                <em>{filterCounts[f.key]}</em>
              </button>
            ))}
          </div>
          <button className="ghost reset-demo" onClick={resetDemo}>恢复示例数据</button>
        </aside>

        <section className="panel form-panel">
          <div className="heading">
            <div>
              <p>新增修蹄记录</p>
              <h2>按马匹编号登记</h2>
            </div>
            <button className="primary" onClick={() => doSave(false)}>
              保存记录
            </button>
          </div>

          <div className="form-top">
            <label>
              <span>马匹编号 *</span>
              <input
                list="horse-id-list"
                value={horseId}
                onChange={(e) => setHorseId(e.target.value.toUpperCase())}
                placeholder="如 HORSE-18（已有的马可直接选择）"
              />
            </label>
            <label>
              <span>修蹄日期 *</span>
              <input type="date" value={date} max={todayStr()} onChange={(e) => setDate(e.target.value)} />
            </label>
            <label>
              <span>下次复查日期 *</span>
              <input type="date" value={reviewDate} min={date} onChange={(e) => setReviewDate(e.target.value)} />
            </label>
            <label>
              <span>本次整体备注</span>
              <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="训练安排、教练沟通等" />
            </label>
          </div>

          <p className="hoof-hint">
            勾选本次修整的蹄位，分别填写蹄形、步态、蹄铁与钉位；步态问题留空表示该蹄步态正常。
          </p>
          <div className="hoof-form-grid">
            {HOOF_ORDER.map((pos) => (
              <HoofForm
                key={pos}
                pos={pos}
                enabled={enabled[pos]}
                hoof={hooves[pos]}
                onToggle={(v) => setEnabled((prev) => ({ ...prev, [pos]: v }))}
                onChange={(next) => setHooves((prev) => ({ ...prev, [pos]: next }))}
              />
            ))}
          </div>

          {formError && (
            <div className="form-error" role="alert">
              ⚠ {formError}
            </div>
          )}
          {conflict && (
            <div className="conflict" role="alertdialog">
              <h3>日期冲突</h3>
              <p>
                <b>{horseId.trim().toUpperCase()}</b> 最近一次修蹄日期为{" "}
                <b>{conflict.latest.date}</b>，本次填写的 <b>{date}</b> 早于该日期。
                原记录已完整保留、未被覆盖。
              </p>
              <p className="conflict-sub">
                如果这是一次补录的历史修蹄，可选择“仍要补录”；否则请修改日期或更换马匹编号。
              </p>
              <div className="conflict-actions">
                <button className="primary" onClick={() => doSave(true)}>仍要补录（保留全部原记录）</button>
                <button onClick={() => setConflict(null)}>返回修改</button>
              </div>
            </div>
          )}
        </section>
      </section>

      {/* 档案列表 */}
      <section className="panel archive">
        <div className="heading">
          <div>
            <p>蹄铁更换历史</p>
            <h2>马匹修蹄档案{filtered.length > 0 && ` · ${filtered.length} 匹`}</h2>
          </div>
          <button onClick={exportCsv}>导出 CSV</button>
        </div>
        {filtered.length === 0 ? (
          <p className="empty">没有符合筛选条件的马匹。</p>
        ) : (
          <div className="horse-list">
            {filtered.map((g) => (
              <HorseCard
                key={g.horseId}
                group={g}
                expanded={expanded.has(g.horseId)}
                onToggle={() => toggleHorse(g.horseId)}
                onDeleteRecord={deleteRecord}
                registerRef={(el) => {
                  if (el) cardRefs.current.set(g.horseId, el);
                  else cardRefs.current.delete(g.horseId);
                }}
              />
            ))}
          </div>
        )}
      </section>

      {toast && <div className="toast">{toast}</div>}
    </main>
  );
}

export default App;
