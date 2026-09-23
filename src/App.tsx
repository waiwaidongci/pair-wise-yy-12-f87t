import { useMemo, useState } from "react";
import "./styles.css";
import {
  fileToThumb,
  formatCN,
  HOOF_SHAPE_OPTIONS,
  HoofDraft,
  HoofPosition,
  HorseSummary,
  isAbnormalRecord,
  loadRecords,
  NAIL_PATTERN_PRESETS,
  normalizeHorseId,
  offsetDate,
  POSITIONS,
  POSITION_MAP,
  persistRecords,
  recheckStatus,
  SHOE_TYPE_OPTIONS,
  summarize,
  todayISO,
  toCSV,
  TrimmingRecord,
  uid,
} from "./farrier";

type ListFilter = "all" | "abnormal" | "recheck" | "front" | "hind";

const FILTERS: { value: ListFilter; label: string }[] = [
  { value: "all", label: "全部马匹" },
  { value: "abnormal", label: "异常步态" },
  { value: "recheck", label: "待复查" },
  { value: "front", label: "前蹄" },
  { value: "hind", label: "后蹄" },
];

interface SaveOutcome {
  ok: boolean;
  conflictDate?: string;
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;

function emptyHoof(position: HoofPosition = "LF"): HoofDraft {
  return {
    localId: uid(),
    position,
    hoofShape: "",
    gaitIssue: "",
    shoeType: "",
    nailPattern: "",
    photoNote: "",
  };
}

function App() {
  const [records, setRecords] = useState<TrimmingRecord[]>(() => loadRecords());
  const [filter, setFilter] = useState<ListFilter>("all");
  const [query, setQuery] = useState("");
  const [pending, setPending] = useState<TrimmingRecord | null>(null);
  const [pendingLatest, setPendingLatest] = useState<string>("");
  const [lightbox, setLightbox] = useState<string>("");
  const [toast, setToast] = useState<{ text: string; kind: "ok" | "warn" } | null>(null);

  const summaries = useMemo(() => summarize(records), [records]);

  const metrics = {
    horses: summaries.length,
    abnormal: summaries.filter((s) => s.abnormal).length,
    recheck: summaries.filter((s) => s.recheckDiff <= 7).length,
    changes: records.length,
  };

  const horseOptions = useMemo(
    () => summaries.map((s) => s.horseId),
    [summaries]
  );

  function showToast(text: string, kind: "ok" | "warn" = "ok") {
    setToast({ text, kind });
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => setToast(null), 3200);
  }

  function commit(rec: TrimmingRecord) {
    setRecords((prev) => {
      const next = [...prev, rec];
      persistRecords(next);
      return next;
    });
    showToast(`已保存 ${rec.horseId} 的修蹄记录`);
  }

  // 保存：日期早于该马最近一次修蹄时，先弹冲突确认，原记录保持不动
  function handleSave(rec: TrimmingRecord): SaveOutcome {
    const latest = summaries.find((s) => s.horseId === rec.horseId)?.latest;
    if (latest && rec.date < latest.date) {
      setPending(rec);
      setPendingLatest(latest.date);
      return { ok: false, conflictDate: latest.date };
    }
    commit(rec);
    return { ok: true };
  }

  function confirmConflict() {
    if (pending) commit(pending);
    setPending(null);
  }

  function exportCSV() {
    const blob = new Blob([toCSV(records)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `修蹄档案_${todayISO()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const q = query.trim().toLowerCase();
  const visible = summaries.filter((s) => {
    if (filter === "abnormal" && !s.abnormal) return false;
    if (filter === "recheck" && s.recheckDiff > 7) return false;
    if (filter === "front" && !s.latest.hooves.some((h) => POSITION_MAP[h.position].limb === "前蹄"))
      return false;
    if (filter === "hind" && !s.latest.hooves.some((h) => POSITION_MAP[h.position].limb === "后蹄"))
      return false;
    if (!q) return true;
    const haystack = [
      s.horseId,
      s.latest.note,
      ...s.latest.hooves.flatMap((h) => [h.hoofShape, h.gaitIssue, h.shoeType, h.nailPattern, h.photoNote]),
    ]
      .join(" ")
      .toLowerCase();
    return haystack.includes(q);
  });

  return (
    <main className="app">
      <header className="topbar">
        <div>
          <p className="kicker">马术俱乐部 · 蹄铁师工作台</p>
          <h1>马术蹄铁修整档案</h1>
          <span className="subtitle">
            按马匹编号建档：左右前后蹄对比、异常步态标记、复查提醒与蹄铁更换历史，数据保存在本机浏览器。
          </span>
        </div>
        <button className="primary" onClick={exportCSV}>
          导出 CSV
        </button>
      </header>

      <section className="metrics">
        <button className="metric" onClick={() => setFilter("all")}>
          <small>马匹档案</small>
          <strong>{metrics.horses}</strong>
        </button>
        <button
          className={`metric metric-warn${filter === "abnormal" ? " active" : ""}`}
          onClick={() => setFilter("abnormal")}
        >
          <small>异常步态</small>
          <strong>{metrics.abnormal}</strong>
        </button>
        <button
          className={`metric metric-amber${filter === "recheck" ? " active" : ""}`}
          onClick={() => setFilter("recheck")}
        >
          <small>待复查（7天内）</small>
          <strong>{metrics.recheck}</strong>
        </button>
        <button className="metric" onClick={() => setFilter("all")}>
          <small>累计修蹄/换铁</small>
          <strong>{metrics.changes}</strong>
        </button>
      </section>

      <section className="workspace">
        <RecheckPanel
          summaries={summaries}
          onLocate={(id) => {
            setFilter("all");
            setQuery(id);
          }}
        />

        <RecordForm key={`form-${records.length}`} horseOptions={horseOptions} onSave={handleSave} />
      </section>

      <section className="panel">
        <div className="heading">
          <div>
            <p>马匹档案</p>
            <h2>马匹列表 · 历次更换按时间排在一起</h2>
          </div>
          <input
            className="search"
            placeholder="搜索马匹编号 / 步态 / 蹄铁…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        <div className="chips filter-chips">
          {FILTERS.map((f) => (
            <button
              key={f.value}
              className={filter === f.value ? "chip active" : "chip"}
              onClick={() => setFilter(f.value)}
            >
              {f.label}
            </button>
          ))}
        </div>

        <div className="horse-list">
          {visible.length === 0 && (
            <p className="empty">没有符合条件的马匹，换个筛选条件或在上方新增记录。</p>
          )}
          {visible.map((s) => (
            <HorseCard
              key={s.horseId}
              summary={s}
              highlighted={q !== "" && s.horseId.toLowerCase().includes(q)}
              onPhoto={setLightbox}
            />
          ))}
        </div>
      </section>

      {pending && (
        <ConflictModal
          horseId={pending.horseId}
          newDate={pending.date}
          latestDate={pendingLatest}
          recheckDate={pending.recheckDate}
          onCancel={() => setPending(null)}
          onConfirm={confirmConflict}
        />
      )}

      {lightbox && (
        <div className="lightbox" onClick={() => setLightbox("")}>
          <img src={lightbox} alt="蹄部照片" />
        </div>
      )}

      {toast && <div className={`toast toast-${toast.kind}`}>{toast.text}</div>}
    </main>
  );
}

// ---------- 复查提醒 ----------

function RecheckPanel({
  summaries,
  onLocate,
}: {
  summaries: HorseSummary[];
  onLocate: (horseId: string) => void;
}) {
  const [onlyAbnormal, setOnlyAbnormal] = useState(false);

  const sorted = useMemo(
    () =>
      summaries
        .filter((s) => !onlyAbnormal || s.abnormal)
        .slice()
        .sort((a, b) => a.recheckDiff - b.recheckDiff),
    [summaries, onlyAbnormal]
  );

  const dueCount = summaries.filter((s) => s.recheckDiff <= 7).length;

  return (
    <aside className="panel side-panel">
      <h2>复查提醒</h2>
      <p className="side-hint">
        共 <b>{dueCount}</b> 匹马 7 天内到期（含已逾期）
      </p>
      <label className="inline-check">
        <input type="checkbox" checked={onlyAbnormal} onChange={(e) => setOnlyAbnormal(e.target.checked)} />
        只看异常步态
      </label>

      <div className="recheck-list">
        {sorted.length === 0 && <p className="empty">暂无符合条件的马匹。</p>}
        {sorted.map((s) => {
          const st = recheckStatus(s.latest.recheckDate);
          const gaitText = s.latest.hooves
            .filter((h) => h.gaitIssue.trim())
            .map((h) => `${POSITION_MAP[h.position].short}：${h.gaitIssue}`)
            .join("；");
          return (
            <button
              key={s.horseId}
              className={`recheck-item tone-${st.tone}${s.abnormal ? " abnormal" : ""}`}
              onClick={() => onLocate(s.horseId)}
            >
              <div className="recheck-row">
                <b>{s.horseId}</b>
                <span className={`badge badge-${st.tone}`}>{st.label}</span>
              </div>
              <div className="recheck-row sub">
                <span>复查日 {formatCN(s.latest.recheckDate)}</span>
                {s.abnormal && <span className="gait-flag">⚠ 异常步态</span>}
              </div>
              {gaitText && <p className="gait-text">{gaitText}</p>}
            </button>
          );
        })}
      </div>
    </aside>
  );
}

// ---------- 新增记录表单 ----------

function RecordForm({
  horseOptions,
  onSave,
}: {
  horseOptions: string[];
  onSave: (rec: TrimmingRecord) => SaveOutcome;
}) {
  const [horseId, setHorseId] = useState("");
  const [date, setDate] = useState(todayISO());
  const [recheckDate, setRecheckDate] = useState(offsetDate(todayISO(), 14));
  const [note, setNote] = useState("");
  const [hooves, setHooves] = useState<HoofDraft[]>([emptyHoof()]);
  const [errors, setErrors] = useState<string[]>([]);

  const normalized = normalizeHorseId(horseId);
  const isExisting = horseOptions.includes(normalized);

  function updateHoof(localId: string, patch: Partial<HoofDraft>) {
    setHooves((prev) => prev.map((h) => (h.localId === localId ? { ...h, ...patch } : h)));
  }

  function addHoof() {
    const used = new Set(hooves.map((h) => h.position));
    const nextPos = POSITIONS.find((p) => !used.has(p.value))?.value ?? "LF";
    setHooves((prev) => [...prev, emptyHoof(nextPos)]);
  }

  function removeHoof(localId: string) {
    setHooves((prev) => prev.filter((h) => h.localId !== localId));
  }

  async function pickPhoto(localId: string, file: File | undefined) {
    if (!file) return;
    try {
      const { dataUrl, name } = await fileToThumb(file);
      updateHoof(localId, { photoData: dataUrl, photoName: name });
    } catch {
      setErrors((prev) => [...prev, "照片处理失败，请换一张图片"]);
    }
  }

  function validate(): string[] {
    const errs: string[] = [];
    if (!horseId.trim()) errs.push("请填写马匹编号");
    if (!date) errs.push("请选择修蹄日期");
    if (!recheckDate) errs.push("请选择复查日期");
    if (date && recheckDate && recheckDate < date)
      errs.push("复查日期不能早于修蹄日期");
    if (hooves.length === 0) errs.push("至少记录一个蹄位");
    const seen = new Set<HoofPosition>();
    hooves.forEach((h, i) => {
      const tag = `第 ${i + 1} 个蹄位（${POSITION_MAP[h.position].label}）`;
      if (seen.has(h.position)) errs.push(`蹄位重复：${POSITION_MAP[h.position].label} 只填一次即可`);
      seen.add(h.position);
      if (!h.hoofShape.trim()) errs.push(`${tag}：请填写蹄形评估`);
      if (!h.shoeType.trim()) errs.push(`${tag}：请填写蹄铁类型`);
      if (!h.nailPattern.trim()) errs.push(`${tag}：请填写钉位`);
    });
    return errs;
  }

  function handleSubmit() {
    const errs = validate();
    if (errs.length) {
      setErrors(errs);
      return;
    }
    const rec: TrimmingRecord = {
      id: uid(),
      horseId: normalizeHorseId(horseId),
      date,
      recheckDate,
      note: note.trim(),
      createdAt: Date.now(),
      hooves: hooves.map(({ localId: _ignored, ...rest }) => {
        void _ignored;
        return rest;
      }),
    };
    const outcome = onSave(rec);
    if (outcome.ok) {
      // 保存成功后由外层 key 重新挂载表单，自动清空作业内容
      setErrors([]);
    } else {
      setErrors([`日期冲突：该马最近一次修蹄为 ${outcome.conflictDate}，请在弹窗中确认。`]);
    }
  }

  return (
    <section className="panel form-panel">
      <div className="heading">
        <div>
          <p>修蹄作业单</p>
          <h2>新增修蹄 / 换蹄铁记录</h2>
        </div>
        <button className="primary" onClick={handleSubmit}>
          保存记录
        </button>
      </div>

      {errors.length > 0 && (
        <div className="form-errors">
          {errors.map((e, i) => (
            <p key={i}>• {e}</p>
          ))}
        </div>
      )}

      <div className="field-grid">
        <label className="field">
          <span>马匹编号 *</span>
          <input
            list="horse-id-list"
            placeholder="如 HORSE-18（已有的马会自动归档到一起）"
            value={horseId}
            onChange={(e) => setHorseId(e.target.value.toUpperCase())}
          />
          <datalist id="horse-id-list">
            {horseOptions.map((id) => (
              <option key={id} value={id} />
            ))}
          </datalist>
          {isExisting && <small className="field-hint">已建档马匹，本次记录会并入它的更换历史。</small>}
        </label>

        <label className="field">
          <span>作业备注</span>
          <input
            placeholder="如：两周后复查磨耗情况"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </label>

        <label className="field">
          <span>修蹄日期 *</span>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>

        <label className="field">
          <span>下次复查日期 *</span>
          <input
            type="date"
            value={recheckDate}
            onChange={(e) => setRecheckDate(e.target.value)}
          />
          <div className="quick-row">
            {[14, 21, 42].map((d) => (
              <button
                type="button"
                key={d}
                className="mini"
                onClick={() => setRecheckDate(offsetDate(date, d))}
              >
                +{d} 天
              </button>
            ))}
          </div>
        </label>
      </div>

      <div className="hoof-editor-head">
        <h3>蹄位记录（左右前蹄 / 后蹄分别填写）</h3>
        <button type="button" className="ghost" onClick={addHoof} disabled={hooves.length >= 4}>
          + 添加蹄位（{hooves.length}/4）
        </button>
      </div>

      <datalist id="hoof-shape-list">
        {HOOF_SHAPE_OPTIONS.map((o) => (
          <option key={o} value={o} />
        ))}
      </datalist>
      <datalist id="shoe-type-list">
        {SHOE_TYPE_OPTIONS.map((o) => (
          <option key={o} value={o} />
        ))}
      </datalist>
      <datalist id="nail-list">
        {NAIL_PATTERN_PRESETS.map((o) => (
          <option key={o} value={o} />
        ))}
      </datalist>

      <div className="hoof-editor">
        {hooves.map((h, idx) => (
          <article className="hoof-card" key={h.localId}>
            <div className="hoof-card-head">
              <label className="field">
                <span>蹄位 *</span>
                <select
                  value={h.position}
                  onChange={(e) =>
                    updateHoof(h.localId, { position: e.target.value as HoofPosition })
                  }
                >
                  {POSITIONS.map((p) => (
                    <option
                      key={p.value}
                      value={p.value}
                      disabled={hooves.some((o) => o.localId !== h.localId && o.position === p.value)}
                    >
                      {p.label}
                    </option>
                  ))}
                </select>
              </label>
              {hooves.length > 1 && (
                <button type="button" className="mini danger" onClick={() => removeHoof(h.localId)}>
                  删除该蹄
                </button>
              )}
              <span className="hoof-index">#{idx + 1}</span>
            </div>

            <div className="hoof-fields">
              <label className="field">
                <span>蹄形评估 *</span>
                <input
                  list="hoof-shape-list"
                  placeholder="如 外侧壁偏长、浅表蹄裂"
                  value={h.hoofShape}
                  onChange={(e) => updateHoof(h.localId, { hoofShape: e.target.value })}
                />
              </label>

              <label className="field">
                <span>步态问题（正常请留空）</span>
                <input
                  placeholder="如 运步轻微不稳、外侧磨耗"
                  className={h.gaitIssue.trim() ? "gait-input" : ""}
                  value={h.gaitIssue}
                  onChange={(e) => updateHoof(h.localId, { gaitIssue: e.target.value })}
                />
              </label>

              <label className="field">
                <span>蹄铁类型 *</span>
                <input
                  list="shoe-type-list"
                  placeholder="如 铝合金蹄铁、护蹄垫"
                  value={h.shoeType}
                  onChange={(e) => updateHoof(h.localId, { shoeType: e.target.value })}
                />
              </label>

              <label className="field">
                <span>钉位 *</span>
                <input
                  list="nail-list"
                  placeholder="如 内侧1-3、外侧1-4"
                  value={h.nailPattern}
                  onChange={(e) => updateHoof(h.localId, { nailPattern: e.target.value })}
                />
              </label>
            </div>

            <div className="photo-row">
              <label className="field photo-field">
                <span>照片备注</span>
                <textarea
                  rows={2}
                  placeholder="照片内容说明，如：右前蹄底面、外侧壁特写"
                  value={h.photoNote}
                  onChange={(e) => updateHoof(h.localId, { photoNote: e.target.value })}
                />
              </label>
              <div className="photo-upload">
                <input
                  type="file"
                  accept="image/*"
                  id={`photo-${h.localId}`}
                  onChange={(e) => pickPhoto(h.localId, e.target.files?.[0])}
                />
                {h.photoData ? (
                  <div className="thumb-wrap">
                    <img className="thumb" src={h.photoData} alt={h.photoName || "蹄部照片"} />
                    <button
                      type="button"
                      className="mini danger"
                      onClick={() => updateHoof(h.localId, { photoData: undefined, photoName: undefined })}
                    >
                      移除照片
                    </button>
                  </div>
                ) : (
                  <span className="thumb-placeholder">点击选择蹄部照片（自动压缩）</span>
                )}
              </div>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

// ---------- 日期冲突弹窗 ----------

function ConflictModal({
  horseId,
  newDate,
  latestDate,
  recheckDate,
  onCancel,
  onConfirm,
}: {
  horseId: string;
  newDate: string;
  latestDate: string;
  recheckDate: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="modal">
        <h2>日期冲突</h2>
        <p>
          <b>{horseId}</b> 最近一次修蹄日期是 <b>{formatCN(latestDate)}</b>，
          你正在保存的修蹄日期是 <b>{formatCN(newDate)}</b>（复查 {formatCN(recheckDate)}），早于最近一次记录。
        </p>
        <p className="modal-note">
          如果继续保存，原有记录会原样保留，本次记录将按日期插入该马的更换历史；如日期填错，请返回修改。
        </p>
        <div className="modal-actions">
          <button className="primary" onClick={onCancel}>
            返回修改日期
          </button>
          <button className="ghost" onClick={onConfirm}>
            日期无误，仍然保存
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------- 马匹档案卡片 ----------

function HorseCard({
  summary,
  highlighted,
  onPhoto,
}: {
  summary: HorseSummary;
  highlighted: boolean;
  onPhoto: (src: string) => void;
}) {
  const st = recheckStatus(summary.latest.recheckDate);
  const latestByPos = new Map(summary.latest.hooves.map((h) => [h.position, h]));

  return (
    <article className={`horse-card${summary.abnormal ? " abnormal" : ""}${highlighted ? " highlighted" : ""}`}>
      <div className="horse-head">
        <div className="horse-title">
          <h3>
            {summary.horseId}
            {summary.abnormal && <span className="gait-flag big">⚠ 异常步态</span>}
          </h3>
          <p>
            最近修蹄：{formatCN(summary.latest.date)} · 共 {summary.records.length} 次记录
          </p>
        </div>
        <span className={`badge badge-${st.tone}`}>
          {st.label}（{formatCN(summary.latest.recheckDate)}）
        </span>
      </div>

      <div className="hoof-compare">
        {POSITIONS.map((p) => {
          const h = latestByPos.get(p.value);
          return (
            <div key={p.value} className={`hoof-cell${h ? "" : " empty"}`}>
              <div className="hoof-cell-head">
                <b>{p.label}</b>
                {h?.gaitIssue.trim() && <span className="gait-dot" title="异常步态" />}
              </div>
              {h ? (
                <dl>
                  <dt>蹄形</dt>
                  <dd>{h.hoofShape}</dd>
                  <dt>步态</dt>
                  <dd className={h.gaitIssue.trim() ? "gait-dd" : ""}>
                    {h.gaitIssue.trim() ? h.gaitIssue : "正常"}
                  </dd>
                  <dt>蹄铁</dt>
                  <dd>{h.shoeType}</dd>
                  <dt>钉位</dt>
                  <dd>{h.nailPattern}</dd>
                  {h.photoData && (
                    <img
                      className="thumb tiny"
                      src={h.photoData}
                      alt={h.photoName || "蹄部照片"}
                      title={h.photoName || "查看大图"}
                      onClick={() => onPhoto(h.photoData!)}
                    />
                  )}
                </dl>
              ) : (
                <p className="cell-empty">本次未记录</p>
              )}
            </div>
          );
        })}
      </div>

      {summary.latest.note && <p className="horse-note">📝 {summary.latest.note}</p>}

      <div className="history">
        <h4>蹄铁更换历史（按时间排列）</h4>
        {summary.records.map((r, i) => (
          <TimelineItem key={r.id} record={r} isLatest={i === 0} defaultOpen={i === 0} onPhoto={onPhoto} />
        ))}
      </div>
    </article>
  );
}

function TimelineItem({
  record,
  isLatest,
  defaultOpen,
  onPhoto,
}: {
  record: TrimmingRecord;
  isLatest: boolean;
  defaultOpen: boolean;
  onPhoto: (src: string) => void;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const abnormal = isAbnormalRecord(record);
  const shoes = Array.from(new Set(record.hooves.map((h) => h.shoeType)));
  const gaitParts = record.hooves
    .filter((h) => h.gaitIssue.trim())
    .map((h) => POSITION_MAP[h.position].short);

  return (
    <div className={`timeline-item${abnormal ? " abnormal" : ""}`}>
      <button className="timeline-head" onClick={() => setOpen((v) => !v)}>
        <span className="timeline-date">
          {formatCN(record.date)}
          {isLatest && <span className="latest-tag">最近</span>}
          {abnormal && <span className="gait-flag">⚠ 步态异常</span>}
        </span>
        <span className="timeline-summary">
          {record.hooves.map((h) => (
            <span key={h.position} className="pos-chip" data-limb={POSITION_MAP[h.position].limb}>
              {POSITION_MAP[h.position].short}
            </span>
          ))}
          <span className="timeline-shoes">{shoes.join("、") || "裸蹄修整"}</span>
          {gaitParts.length > 0 && <span className="timeline-gait">{gaitParts.join("/")}异常</span>}
          <span className="timeline-recheck">复查 {record.recheckDate}</span>
        </span>
        <span className="timeline-caret">{open ? "收起 ▲" : "展开 ▼"}</span>
      </button>

      {open && (
        <div className="timeline-body">
          {record.hooves.map((h) => (
            <div className="timeline-hoof" key={h.position}>
              <b>{POSITION_MAP[h.position].label}</b>
              <span>蹄形：{h.hoofShape}</span>
              <span className={h.gaitIssue.trim() ? "gait-dd" : ""}>
                步态：{h.gaitIssue.trim() ? h.gaitIssue : "正常"}
              </span>
              <span>蹄铁：{h.shoeType}</span>
              <span>钉位：{h.nailPattern}</span>
              {h.photoData && (
                <img
                  className="thumb tiny"
                  src={h.photoData}
                  alt={h.photoName || "蹄部照片"}
                  onClick={() => onPhoto(h.photoData!)}
                />
              )}
            </div>
          ))}
          {record.note && <p className="timeline-note">备注：{record.note}</p>}
          {record.hooves.some((h) => h.photoNote.trim()) && (
            <p className="timeline-note">
              照片备注：
              {record.hooves
                .filter((h) => h.photoNote.trim())
                .map((h) => `${POSITION_MAP[h.position].short} ${h.photoNote}`)
                .join("；")}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export default App;
