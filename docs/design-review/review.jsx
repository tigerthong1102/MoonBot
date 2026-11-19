import React, { useState, useEffect, useRef } from "react";
import brandMark from "./mark.png";
import { createRoot } from "react-dom/client";
import {
  House,
  ListChecks,
  Blocks,
  UsersRound,
  History,
  Settings2,
  MessagesSquare,
  Monitor,
  SlidersHorizontal,
  Sun,
  Moon,
  ArrowUpRight,
  ArrowRight,
  ArrowUp,
  ArrowDown,
  ChevronRight,
  ChevronsUpDown,
  Folder,
  FileText,
  CircleCheck,
  ShieldCheck,
  Activity,
  SquarePen,
  ClipboardCheck,
  Layers,
  BriefcaseBusiness,
  BookOpen,
  Pin,
  Eye,
  EyeOff,
  Undo2,
  X,
  Send,
  Search,
  Menu,
  Plug,
  WifiOff,
} from "lucide-react";
import {
  sectors,
  sections,
  statuses,
  defaultLayouts,
  seed,
  load,
  save,
  layoutFor,
} from "./model.js";
const nav = {
  home: ["Trang chủ", House],
  work: ["Công việc", ListChecks],
  apps: ["Ứng dụng", Blocks],
  agents: ["Nhân viên AI", UsersRound],
  history: ["Lịch sử", History],
  settings: ["Cài đặt", Settings2],
  chat: ["Hội thoại", MessagesSquare],
  computer: ["Máy tính", Monitor],
};
const variants = { A: "Sổ công tác", B: "Bàn điều hành", C: "Bảng luồng" };
const markers = {
  review: ClipboardCheck,
  running: Activity,
  done: CircleCheck,
};
const prompts = {
  general: "Tóm tắt cuộc họp",
  accounting: "Đối chiếu hóa đơn",
  sales: "Soạn thư phản hồi",
  marketing: "Soạn bài giới thiệu",
};
const params = new URLSearchParams(location.search);
const concept = Object.hasOwn(variants, params.get("concept"))
  ? params.get("concept")
  : "B";
function IconButton({ label, children, ...props }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className="iconBtn"
      {...props}
    >
      {children}
    </button>
  );
}
function Avatar({ name }) {
  return (
    <span aria-hidden="true" className={"avatar avatar-" + name}>
      {name.slice(0, 1)}
    </span>
  );
}
function Status({ state }) {
  return (
    <span className={"status " + state}>
      <i />
      {statuses[state]}
    </span>
  );
}
function Dialog({ title, children, close }) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    const opener = document.activeElement;
    el.showModal();
    return () => {
      el.close();
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, []);
  return (
    <dialog ref={ref} aria-label={title} onCancel={close}>
      <header>
        <h2>{title}</h2>
        <IconButton label="Đóng" onClick={close}>
          <X />
        </IconButton>
      </header>
      {children}
    </dialog>
  );
}
function App() {
  const [sector, setSector] = useState(() => {
    const v = load("sector", "general");
    return Object.hasOwn(sectors, v) ? v : "general";
  });
  const team = sectors[sector];
  const [preset, setPreset] = useState(() => {
    const p = load("preset/" + sector, sector);
    return Object.hasOwn(sectors, p) ? p : sector;
  });
  const template = sectors[preset];
  const [theme, setTheme] = useState(() => load("theme", "system"));
  const [page, setPage] = useState("home"),
    [filter, setFilter] = useState("all"),
    [query, setQuery] = useState(""),
    [mobile, setMobile] = useState(false);
  const [tasks, setTasks] = useState(() =>
    load("tasks/" + sector, seed(sector)),
  );
  const [agent, setAgent] = useState(team.agent),
    [text, setText] = useState(""),
    [focusTask, setFocusTask] = useState(null),
    [thread, setThread] = useState(null);
  const [modal, setModal] = useState(null),
    [details, setDetails] = useState(""),
    [online, setOnline] = useState(true),
    [restricted, setRestricted] = useState(() => load("ask/" + sector, false));
  const [layout, setLayout] = useState(() => layoutFor(sector)),
    [previous, setPrevious] = useState(null),
    [proposal, setProposal] = useState(null),
    [wish, setWish] = useState(""),
    [note, setNote] = useState("");
  const [denyNext, setDenyNext] = useState(false);
  const [clock, setClock] = useState(Date.now()),
    [artifact, setArtifact] = useState(null);
  const draftBox = useRef(null),
    sent = useRef(false),
    [chatText, setChatText] = useState("");
  const pendingRun = tasks.some((t) => t.until);
  useEffect(() => {
    if (!pendingRun) return;
    const timer = setInterval(() => setClock(Date.now()), 250);
    return () => clearInterval(timer);
  }, [pendingRun]);
  useEffect(() => {
    if (!online || !tasks.some((t) => t.until && t.until <= clock)) return;
    const next = tasks.map((t) =>
      t.until && t.until <= clock ? { ...t, until: 0, state: "done" } : t,
    );
    updateTasks(next);
  }, [clock, online, tasks]);
  function updateTasks(next) {
    save("tasks/" + sector, next);
    setTasks(next);
  }
  function applyLayout(next) {
    setPrevious(layout);
    save("layout/" + sector, next);
    setLayout(next);
    setProposal(null);
  }
  function go(p) {
    setPage(p);
    setMobile(false);
    setQuery("");
    setNote("");
  }
  function showWork(id) {
    setFocusTask(id);
    setFilter("all");
    go("work");
  }
  function showChat(id) {
    setThread(id);
    setChatText("");
    go("chat");
  }
  function showList(state) {
    setFilter(state);
    setFocusTask(null);
    go("work");
  }
  function suggest() {
    editDraft(template.prompt);
    go("home");
    setTimeout(() => draftBox.current?.focus(), 0);
  }
  function switchSector(id) {
    if (!Object.hasOwn(sectors, id) || id === sector) return;
    save("draft/" + sector, text);
    save("sector", id);
    setSector(id);
    setDenyNext(false);
    setTasks(load("tasks/" + id, seed(id)));
    setAgent(sectors[id].agent);
    setRestricted(load("ask/" + id, false));
    const saved = load("preset/" + id, id);
    setPreset(Object.hasOwn(sectors, saved) ? saved : id);
    setText(load("draft/" + id, ""));
    setLayout(layoutFor(id));
    setPrevious(null);
    setProposal(null);
    setWish("");
    setThread(null);
    setFocusTask(null);
    setFilter("all");
    setModal(null);
    setChatText("");
    go("home");
  }
  useEffect(() => {
    setText(load("draft/" + sector, ""));
  }, [sector]);
  function editDraft(value) {
    sent.current = false;
    setText(value);
    save("draft/" + sector, value);
  }
  function send(value, conversation = null) {
    if (!online || !value.trim() || sent.current) return;
    sent.current = true;
    const id = crypto.randomUUID(),
      now = new Date(),
      content = value.trim();
    const record = {
      id,
      thread: conversation ?? "chat-" + id,
      title: content.split("\n")[0],
      request: content,
      agent: conversation
        ? (tasks.find((t) => t.thread === conversation)?.agent ?? team.agent)
        : agent,
      state: restricted ? "review" : "running",
      until: restricted ? 0 : Date.now() + 3200,
      time: now.toLocaleTimeString("vi", {
        hour: "2-digit",
        minute: "2-digit",
      }),
      output: template.output,
      file: template.file,
    };
    if (denyNext) {
      record.state = "error";
      record.until = 0;
      setDenyNext(false);
    }
    updateTasks([record, ...tasks]);
    setText("");
    save("draft/" + sector, "");
    setChatText("");
    if (conversation) showChat(conversation);
    else showWork(id);
    queueMicrotask(() => {
      sent.current = false;
    });
  }
  function act(id, state) {
    updateTasks(
      tasks.map((t) =>
        t.id === id
          ? { ...t, state, until: state === "running" ? Date.now() + 2200 : 0 }
          : t,
      ),
    );
  }
  function selectTheme(value) {
    setTheme(value);
    save("theme", value);
  }
  function navButton(id) {
    const [name, Icon] = nav[id];
    return (
      <button
        key={id}
        aria-current={page === id ? "page" : undefined}
        onClick={() => {
          if (id === "work") {
            showList("all");
            return;
          }
          go(id);
        }}
      >
        <Icon />
        {name}
      </button>
    );
  }
  function line(t) {
    return (
      <button className="taskRow" key={t.id} onClick={() => showWork(t.id)}>
        <span className={"stamp " + t.state}>
          {t.state === "done" ? (
            <FileText />
          ) : t.state === "review" ? (
            <ClipboardCheck />
          ) : (
            <Activity />
          )}
        </span>
        <span className="rowtext">
          <b>{t.title}</b>
          <small>
            {t.agent} · {t.time}
          </small>
        </span>
        <ChevronRight />
      </button>
    );
  }
  function groups() {
    return [...layout]
      .filter((x) => x.visible)
      .sort((a, b) => Number(b.pinned) - Number(a.pinned))
      .map((w) => {
        const rows = tasks.filter((t) => t.state === w.id),
          Icon = markers[w.id];
        return (
          <section key={w.id} className={"widget widget-" + w.id}>
            <header>
              <h2>
                <Icon />
                {sections[w.id]} {w.pinned && <Pin size={13} />}
              </h2>
              <button className="link" onClick={() => showList(w.id)}>
                Xem {rows.length || "tất cả"} <ArrowRight />
              </button>
            </header>
            {rows.length ? (
              rows.slice(0, 3).map(line)
            ) : (
              <p className="muted">Chưa có mục trong nhóm này.</p>
            )}
          </section>
        );
      });
  }
  const selected = tasks.find((t) => t.id === focusTask);
  const oldThread = "legacy-" + sector;
  const chatId = thread ?? tasks[0]?.thread ?? oldThread;
  const chatRuns = tasks
    .filter((t) => t.thread === chatId)
    .slice()
    .reverse();
  const visibleTasks = tasks.filter(
    (t) =>
      (filter === "all" || t.state === filter) &&
      t.title.toLocaleLowerCase("vi").includes(query.toLocaleLowerCase("vi")),
  );
  function switchWorkspace() {
    setModal("workspace");
  }
  function openLayout() {
    setWish("");
    setProposal(null);
    setNote("");
    setModal("layout");
  }
  const top = (
    <div className="topbar">
      <div className="crumb">
        <IconButton label="Điều hướng" onClick={() => setMobile(!mobile)}>
          <Menu />
        </IconButton>
        <Layers /> Workspace <ChevronRight /> <b>{team.name}</b>
      </div>
      <div className="topactions">
        <span className={"connection " + (!online ? "off" : "")}>
          <i />
          {online ? "Runtime mô phỏng" : "Runtime ngoại tuyến"}
        </span>
        <IconButton
          label="Đổi sáng tối"
          onClick={() =>
            selectTheme(
              theme === "dark" ||
                (theme === "system" &&
                  matchMedia("(prefers-color-scheme: dark)").matches)
                ? "light"
                : "dark",
            )
          }
        >
          {theme === "dark" ? <Sun /> : <Moon />}
        </IconButton>
        <span className="user" title="Tài khoản mẫu">
          BM
        </span>
      </div>
    </div>
  );
  const composer = (
    <section className="composer">
      <label htmlFor="task">Bạn muốn giao việc gì?</label>
      <textarea
        id="task"
        ref={draftBox}
        value={text}
        onChange={(e) => editDraft(e.target.value)}
        placeholder="Nhập yêu cầu hoặc chọn việc gợi ý bên dưới…"
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            send(text);
          }
        }}
      />
      <footer>
        <button className="agentSelect" onClick={() => go("agents")}>
          <Avatar name={agent} />
          {agent}
          <ChevronsUpDown />
        </button>
        <button
          className="primary"
          disabled={!online || !text.trim()}
          onClick={() => send(text)}
        >
          Giao việc <ArrowUpRight />
        </button>
      </footer>
    </section>
  );
  const shortcut = (
    <button className="suggest" onClick={suggest}>
      <SquarePen />
      {prompts[preset]}
      <ArrowUpRight />
    </button>
  );
  function overview() {
    return (
      <aside className="overview">
        <div className="blocktitle">
          <Activity />
          <b>Hoạt động</b>
        </div>
        <div className="total">
          {tasks.length}
          <small>công việc trong workspace</small>
        </div>
        <div className="meter">
          {Object.keys(statuses).map((s) => {
            const n = tasks.filter((t) => t.state === s).length;
            return n ? (
              <span key={s} className={s} style={{ flexGrow: n }} />
            ) : null;
          })}
        </div>
        {["review", "running", "done"].map((s) => (
          <button key={s} className="metric" onClick={() => showList(s)}>
            <span className={"dot " + s} />
            {statuses[s]}
            <b>{tasks.filter((t) => t.state === s).length}</b>
          </button>
        ))}
      </aside>
    );
  }
  const heroTitle =
    page === "home"
      ? { A: "Sổ công tác", B: "Bàn làm việc", C: "Bảng điều phối" }[concept]
      : nav[page][0];
  const mainTitle = (
    <div className="pageTitle">
      <div>
        <h1>{heroTitle}</h1>
      </div>
      {page === "home" && (
        <button className="quiet" onClick={openLayout}>
          <SlidersHorizontal />
          Bố cục
        </button>
      )}
    </div>
  );
  function home() {
    return (
      <>
        {concept === "A" ? (
          <>
            <div className="brief">
              <BookOpen />
              <h2>Việc tiếp theo</h2>
              {shortcut}
            </div>
            {composer}
            <div className="journal">{groups()}</div>
          </>
        ) : concept === "C" ? (
          <>
            {composer}
            <div className="suggestions">{shortcut}</div>
            <div className="lanes">{groups()}</div>
          </>
        ) : (
          <>
            <div className="heroGrid">
              <div>
                {composer}
                <div className="suggestions">
                  <span>Gợi ý</span>
                  {shortcut}
                </div>
              </div>
              {overview()}
            </div>
            <div className="widgets">{groups()}</div>
          </>
        )}
        {!layout.some((w) => w.visible) && (
          <p className="muted">Đã ẩn tất cả widget. Mở Bố cục để hiện lại.</p>
        )}
      </>
    );
  }
  function work() {
    if (concept === "C")
      return (
        <>
          <div className="lanes">
            {Object.entries(statuses)
              .filter(([key]) => tasks.some((t) => t.state === key))
              .map(([key, label]) => (
                <section className="widget" key={key}>
                  <h2>{label}</h2>
                  {tasks.filter((t) => t.state === key).map(line)}
                </section>
              ))}
          </div>
          {selected && (
            <section className="panel detail boardDetail">
              {taskDetail(selected)}
            </section>
          )}
        </>
      );
    return (
      <>
        <div className="tabs">
          {[
            ["all", "Tất cả"],
            ["review", "Cần duyệt"],
            ["running", "Đang chạy"],
            ["done", "Hoàn thành"],
          ].map(([k, v]) => (
            <button
              key={k}
              aria-pressed={k === filter}
              onClick={() => {
                setFilter(k);
                setFocusTask(null);
              }}
            >
              {v}
            </button>
          ))}
        </div>
        <div className="split">
          <section className="panel">
            <h2>Danh sách công việc</h2>
            {visibleTasks.map(line)}
            {!visibleTasks.length && <p>Chưa có công việc phù hợp.</p>}
          </section>
          <section className="panel detail">
            {selected || visibleTasks[0] ? (
              taskDetail(selected || visibleTasks[0])
            ) : (
              <p>Chọn một công việc để xem chi tiết.</p>
            )}
          </section>
        </div>
      </>
    );
  }
  function taskDetail(t) {
    return (
      <>
        <Status state={t.state} />
        <h2>{t.title}</h2>
        <p>
          <Avatar name={t.agent} /> {t.agent} · {t.time}
        </p>
        <dl>
          <dt>Workspace</dt>
          <dd>{team.name}</dd>
          <dt>Mã lần chạy</dt>
          <dd>{t.id}</dd>
        </dl>
        <h3>Yêu cầu</h3>
        <p>{t.request}</p>
        {t.state === "review" && (
          <div className="notice">
            Runtime mẫu yêu cầu duyệt trước khi tạo bản nháp.
            <div className="actions">
              <button
                className="primary"
                disabled={!online}
                onClick={() => act(t.id, "running")}
              >
                Duyệt
              </button>
              <button onClick={() => act(t.id, "cancel")}>Từ chối</button>
            </div>
          </div>
        )}
        {t.state === "running" && (
          <button onClick={() => act(t.id, "cancel")}>Dừng công việc</button>
        )}
        {t.state === "error" && (
          <p role="alert">Runtime mô phỏng đã từ chối yêu cầu.</p>
        )}
        {t.state === "done" && (
          <button
            className="file"
            onClick={() => {
              setArtifact(t);
              setModal("artifact");
            }}
          >
            <FileText />
            {t.file ?? team.file}
            <ArrowUpRight />
          </button>
        )}
        <button className="link" onClick={() => showChat(t.thread)}>
          <MessagesSquare />
          Mở hội thoại <ArrowRight />
        </button>
      </>
    );
  }
  function chat() {
    return (
      <section className="panel chat">
        <div className="chatHead">
          <Avatar name={chatRuns.at(-1)?.agent ?? team.agent} />
          <div>
            <h2>{chatRuns.at(-1)?.agent ?? team.agent}</h2>
            <small>
              {chatId === oldThread ? "Hội thoại cũ" : "Hội thoại công việc"} ·{" "}
              {team.name}
            </small>
          </div>
          <button className="quiet" onClick={() => go("computer")}>
            <Monitor />
            Máy tính
          </button>
        </div>
        {chatId === oldThread && (
          <p className="bubble">
            Đây là ghi chú bàn giao từ hội thoại mẫu trước khi nâng cấp.
          </p>
        )}
        {chatRuns.map((r) => (
          <div className="turn" key={r.id}>
            <p className="bubble mine">{r.request}</p>
            <p className="bubble">
              {r.state === "done" ? r.output : statuses[r.state]}
            </p>
            <button className="link" onClick={() => showWork(r.id)}>
              Chi tiết công việc <ArrowRight />
            </button>
          </div>
        ))}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            send(chatText, chatId);
          }}
        >
          <input
            aria-label="Tin nhắn"
            placeholder="Tiếp tục hội thoại…"
            value={chatText}
            onChange={(e) => setChatText(e.target.value)}
          />
          <button className="primary" disabled={!online || !chatText.trim()}>
            <Send />
            Gửi
          </button>
        </form>
      </section>
    );
  }
  function history() {
    const term = query.toLocaleLowerCase("vi");
    return (
      <section className="panel">
        <label className="search">
          <Search />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Tìm hội thoại hoặc công việc"
            aria-label="Tìm trong lịch sử"
          />
        </label>
        {tasks
          .filter((t) => t.title.toLocaleLowerCase("vi").includes(term))
          .map(line)}
        {"ghi chú bàn giao".includes(term) && (
          <button className="taskRow" onClick={() => showChat(oldThread)}>
            <MessagesSquare />
            <span className="rowtext">
              <b>Ghi chú bàn giao</b>
              <small>Hội thoại cũ · Chưa có mã công việc</small>
            </span>
            <ChevronRight />
          </button>
        )}
      </section>
    );
  }
  function directory(isAgents) {
    const cards = isAgents
      ? [
          [team.agent, team.role],
          ["Mai", "Rà soát bản nháp"],
        ]
      : [
          ["Tệp workspace", "Thư mục dữ liệu tổng hợp"],
          ...(sector === "accounting"
            ? [["MISA mẫu", "Nguồn hóa đơn chỉ đọc"]]
            : []),
          ["Thư điện tử", "Chưa kết nối"],
          ["Lịch làm việc", "Chưa kết nối"],
        ];
    return (
      <div className="cards">
        {cards.map(([name, role], i) => (
          <section className="panel card" key={name}>
            {isAgents ? (
              <Avatar name={name} />
            ) : i === 0 ? (
              <Folder />
            ) : (
              <Plug />
            )}
            <h2>{name}</h2>
            <p>{role}</p>
            <small>
              {isAgents
                ? "Công cụ · " + team.tools
                : i === 0
                  ? "Đã mở · Workspace thử"
                  : "Adapter mô phỏng"}
            </small>
            <button
              className="link"
              onClick={() => {
                if (isAgents) {
                  setAgent(name);
                  suggest();
                } else {
                  setNote("");
                  setDetails(name);
                  setModal("app");
                }
              }}
            >
              {isAgents ? "Giao việc" : "Chi tiết"}
              <ArrowRight />
            </button>
          </section>
        ))}
      </div>
    );
  }
  function settings() {
    return (
      <section className="panel settings">
        {[
          [
            "Giao diện",
            "Sáng, tối hoặc theo hệ thống",
            <select
              aria-label="Giao diện"
              value={theme}
              onChange={(e) => selectTheme(e.target.value)}
            >
              <option value="system">Theo hệ thống</option>
              <option value="light">Sáng</option>
              <option value="dark">Tối</option>
            </select>,
          ],
          [
            "Workspace",
            team.name,
            <button onClick={switchWorkspace}>Chọn workspace</button>,
          ],
          [
            "Mẫu ngành",
            template.name,
            <button onClick={() => setModal("preset")}>Đổi mẫu ngành</button>,
          ],
          [
            "Widget Trang chủ",
            "Thứ tự, ghim và ẩn hiện",
            <button onClick={openLayout}>Chỉnh bố cục</button>,
          ],
          ["Chế độ giao diện", "Nâng cao", <Monitor />],
          [
            "Quyền của luồng thử",
            "Thay đổi policy của runtime mô phỏng",
            <select
              aria-label="Policy mô phỏng"
              value={restricted ? "ask" : "full"}
              onChange={(e) => {
                setRestricted(e.target.value === "ask");
                save("ask/" + sector, e.target.value === "ask");
              }}
            >
              <option value="full">Full Access</option>
              <option value="ask">Yêu cầu duyệt</option>
            </select>,
          ],
          [
            "Từ chối lúc thực thi",
            "Mô phỏng lỗi ở lần giao việc tiếp theo",
            <button
              aria-pressed={denyNext}
              onClick={() => setDenyNext(!denyNext)}
            >
              {denyNext ? "Đã hẹn từ chối" : "Thử từ chối"}
            </button>,
          ],
          [
            "Kết nối runtime",
            "Trạng thái giả lập trong phiên xem thử",
            <button aria-pressed={online} onClick={() => setOnline(!online)}>
              {online ? "Ngắt kết nối thử" : "Nối lại thử"}
            </button>,
          ],
        ].map(([name, desc, control]) => (
          <div className="setting" key={name}>
            <div>
              <b>{name}</b>
              <small>{desc}</small>
            </div>
            {control}
          </div>
        ))}
      </section>
    );
  }
  function adjust(index, key, delta) {
    const next = layout.map((w) => ({ ...w }));
    if (key === "move") {
      const other = index + delta;
      if (other < 0 || other >= next.length) return;
      [next[index], next[other]] = [next[other], next[index]];
    } else next[index][key] = !next[index][key];
    applyLayout(next.sort((a, b) => Number(b.pinned) - Number(a.pinned)));
  }
  function layoutEditor() {
    return (
      <>
        <p>Widget đã ghim xuất hiện trước các widget còn lại.</p>
        {layout.map((w, i) => (
          <div className="setting" key={w.id}>
            <b>{sections[w.id]}</b>
            <div className="actions">
              <IconButton
                label={"Ghim " + sections[w.id]}
                aria-pressed={w.pinned}
                onClick={() => adjust(i, "pinned")}
              >
                <Pin />
              </IconButton>
              <IconButton
                label={"Hiện " + sections[w.id]}
                aria-pressed={w.visible}
                onClick={() => adjust(i, "visible")}
              >
                {w.visible ? <Eye /> : <EyeOff />}
              </IconButton>
              <IconButton
                label={"Đưa lên " + sections[w.id]}
                disabled={!i || layout[i - 1].pinned !== w.pinned}
                onClick={() => adjust(i, "move", -1)}
              >
                <ArrowUp />
              </IconButton>
              <IconButton
                label={"Đưa xuống " + sections[w.id]}
                disabled={
                  i === layout.length - 1 || layout[i + 1].pinned !== w.pinned
                }
                onClick={() => adjust(i, "move", 1)}
              >
                <ArrowDown />
              </IconButton>
            </div>
          </div>
        ))}
        <h3>Đề xuất bố cục mô phỏng</h3>
        <textarea
          aria-label="Yêu cầu bố cục"
          value={wish}
          onChange={(e) => {
            setWish(e.target.value);
            setProposal(null);
            setNote("");
          }}
          placeholder="Đưa việc cần duyệt lên đầu và ẩn kết quả gần đây"
        />
        <button
          onClick={() => {
            if (!online) {
              setNote("Provider ngoại tuyến. Bạn vẫn chỉnh tay được.");
              return;
            }
            if (
              wish.trim().toLocaleLowerCase("vi") !==
              "đưa việc cần duyệt lên đầu và ẩn kết quả gần đây"
            ) {
              setNote("Bộ mô phỏng hỗ trợ câu gợi ý trong ô nhập.");
              return;
            }
            setProposal(
              layout
                .map((w) => ({
                  ...w,
                  pinned: w.id === "review",
                  visible:
                    w.id === "review"
                      ? true
                      : w.id === "done"
                        ? false
                        : w.visible,
                }))
                .sort((a, b) => Number(b.pinned) - Number(a.pinned)),
            );
            setNote("");
          }}
        >
          Xem trước
        </button>
        {proposal && (
          <div className="notice">
            <b>Bố cục sau khi áp dụng</b>
            {proposal.map((w) => (
              <p key={w.id}>
                {sections[w.id]} · {w.visible ? "Hiện" : "Ẩn"}
                {w.pinned ? " · Đã ghim" : ""}
              </p>
            ))}
            <button className="primary" onClick={() => applyLayout(proposal)}>
              Áp dụng
            </button>{" "}
            <button onClick={() => setProposal(null)}>Hủy</button>
          </div>
        )}
        {note && <p role="status">{note}</p>}
        <footer className="actions">
          <button
            onClick={() =>
              applyLayout(
                defaultLayouts[preset].map((id) => ({
                  id,
                  visible: true,
                  pinned: false,
                })),
              )
            }
          >
            Khôi phục bố cục
          </button>
          <button
            disabled={!previous}
            onClick={() => {
              applyLayout(previous);
              setPrevious(null);
            }}
          >
            <Undo2 />
            Hoàn tác
          </button>
        </footer>
      </>
    );
  }
  const screens = {
    home,
    work,
    history,
    chat,
    settings,
    apps: () => directory(false),
    agents: () => directory(true),
    computer: () => (
      <section className="panel">
        <Monitor />
        <h2>Máy tính của {agent}</h2>
        <p>Phiên mô phỏng chưa chia sẻ màn hình.</p>
        <button onClick={() => go("chat")}>
          <MessagesSquare />
          Quay về hội thoại
        </button>
      </section>
    ),
  };
  return (
    <div
      data-concept={concept}
      data-theme={theme}
      className={"shell " + (mobile ? "mobileOpen" : "")}
    >
      <aside className="rail">
        <div className="brand">
          <img className="brandmark" alt="" src={brandMark} />
          StartupBot
        </div>
        <button className="workspace" onClick={switchWorkspace}>
          <span className="wsmark">
            <BriefcaseBusiness />
          </span>
          <span>
            <small>Workspace mẫu</small>
            <b>{team.name}</b>
          </span>
          <ChevronsUpDown />
        </button>
        <nav aria-label="Điều hướng chính">
          {Object.keys(nav).slice(0, 6).map(navButton)}
        </nav>
        <div className="advanced">
          <small>Công cụ nâng cao</small>
          <nav aria-label="Công cụ nâng cao">
            {["chat", "computer"].map(navButton)}
          </nav>
        </div>
        <button
          className="railFoot"
          onClick={() => go("settings")}
          aria-label="Xem quyền của workspace"
        >
          <ShieldCheck />
          <div>
            <b>{restricted ? "Yêu cầu duyệt" : "Full Access"}</b>
            <small>Policy mô phỏng</small>
          </div>
        </button>
      </aside>
      <main>
        {top}
        <article>
          {mainTitle}
          {!online && (
            <p className="notice">
              <WifiOff /> Runtime ngoại tuyến. Có thể đọc dữ liệu đã lưu.
            </p>
          )}
          {screens[page]()}
        </article>
        <footer className="reviewFoot">
          <span>Dữ liệu mô phỏng · Thiết kế {concept}</span>
          <button className="link" onClick={() => setModal("designs")}>
            So sánh thiết kế <ArrowUpRight />
          </button>
        </footer>
      </main>
      {modal && (
        <Dialog
          title={
            {
              layout: "Bố cục Trang chủ",
              workspace: "Chọn workspace mẫu",
              preset: "Mẫu ngành cho Trang chủ",
              designs: "Ba phương án thiết kế",
              artifact: "Kết quả trong workspace",
              app: details,
            }[modal]
          }
          close={() => setModal(null)}
        >
          {modal === "workspace" ? (
            <>
              <p>
                Mỗi workspace mẫu lưu riêng bố cục, công việc và lịch sử. Chọn
                lại workspace để tiếp tục.
              </p>
              {Object.entries(sectors).map(([k, t]) => (
                <button
                  key={k}
                  className="taskRow"
                  onClick={() => {
                    switchSector(k);
                    setModal(null);
                  }}
                >
                  <BriefcaseBusiness />
                  <b>{t.name}</b>
                  {k === sector ? <CircleCheck /> : <ArrowRight />}
                </button>
              ))}
            </>
          ) : modal === "preset" ? (
            <>
              <p>
                Áp dụng mẫu sẽ đổi gợi ý giao việc, đặt lại thứ tự widget và
                hiện tất cả widget trong workspace này.
              </p>
              {Object.entries(sectors).map(([key, t]) => (
                <button
                  className="taskRow"
                  key={key}
                  onClick={() => {
                    setPreset(key);
                    save("preset/" + sector, key);
                    applyLayout(
                      defaultLayouts[key].map((id) => ({
                        id,
                        visible: true,
                        pinned: false,
                      })),
                    );
                    setModal(null);
                  }}
                >
                  <b>{t.name}</b>
                  <span>
                    {defaultLayouts[key].map((id) => sections[id]).join(" · ")}
                  </span>
                </button>
              ))}
            </>
          ) : modal === "layout" ? (
            layoutEditor()
          ) : modal === "artifact" ? (
            <>
              <h3>{artifact?.file ?? team.file}</h3>
              <p className="output">{artifact?.output}</p>
            </>
          ) : modal === "app" ? (
            <>
              <p>
                {details === "MISA mẫu"
                  ? "Nguồn thử chỉ đọc. Có thể xem chứng từ tổng hợp và tạo báo cáo nháp trong workspace Kế toán."
                  : details === "Tệp workspace"
                    ? "Tệp được mô phỏng trong workspace đang chọn."
                    : "Dịch vụ ngoại tuyến trong bản xem thử."}
              </p>
              {details === "MISA mẫu" && (
                <>
                  <button
                    onClick={() =>
                      setNote(
                        "Đã từ chối ghi. Bạn có thể lưu bản đối chiếu nháp trong workspace thử.",
                      )
                    }
                  >
                    Thử yêu cầu ghi mô phỏng
                  </button>
                  {note && <p role="status">{note}</p>}
                </>
              )}
            </>
          ) : (
            Object.entries(variants).map(([k, v]) => (
              <a key={k} className="taskRow" href={"?concept=" + k}>
                <b>
                  {k} · {v}
                </b>
                <ArrowRight />
              </a>
            ))
          )}
        </Dialog>
      )}
    </div>
  );
}
createRoot(document.getElementById("root")).render(<App />);
