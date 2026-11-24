import { App, ItemView, Modal, Notice, Plugin, WorkspaceLeaf, setIcon } from "obsidian";

/* =========================================================
 * 型定義
 * ======================================================= */

type Priority = "low" | "medium" | "high" | "urgent";

interface Subtask {
	id: string;
	text: string;
	done: boolean;
}

interface Task {
	id: string;
	title: string;
	description: string;
	subtasks: Subtask[];
	priority: Priority;
	/** YYYY-MM-DD 形式。未設定なら null */
	deadline: string | null;
	createdAt: number;
}

interface TaskQuestData {
	tasks: Task[];
	completedCount: number;
}

const DEFAULT_DATA: TaskQuestData = {
	tasks: [],
	completedCount: 0,
};

const VIEW_TYPE_TASK_QUEST = "task-quest-view";

const PRIORITY_LABEL: Record<Priority, string> = {
	low: "低",
	medium: "中",
	high: "高",
	urgent: "緊急",
};

/** 数値が大きいほど優先度が高い */
const PRIORITY_WEIGHT: Record<Priority, number> = {
	low: 0,
	medium: 1,
	high: 2,
	urgent: 3,
};

/** 締め切りの何日前から強調表示するか */
const DEADLINE_WARNING_DAYS = 5;

/* =========================================================
 * ユーティリティ
 * ======================================================= */

function genId(): string {
	return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/** 今日の 0:00 から締め切り日の 0:00 までの日数（過ぎていればマイナス） */
function daysUntil(deadline: string): number {
	const [y, m, d] = deadline.split("-").map((v) => parseInt(v, 10));
	const target = new Date(y, m - 1, d);
	const now = new Date();
	const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
	return Math.round((target.getTime() - today.getTime()) / 86400000);
}

function deadlineLabel(deadline: string): string {
	const days = daysUntil(deadline);
	const [y, m, d] = deadline.split("-");
	const base = `${y}/${m}/${d}`;
	if (days < 0) return `${base}（${-days}日超過）`;
	if (days === 0) return `${base}（今日まで）`;
	return `${base}（あと${days}日）`;
}

function progressOf(task: Task): number {
	if (task.subtasks.length === 0) return 0;
	const done = task.subtasks.filter((s) => s.done).length;
	return Math.round((done / task.subtasks.length) * 100);
}

/**
 * 並び順:
 * 1. 「緊急」は締め切りに関係なく常に一番上
 * 2. それ以外は締め切りが近い順（締め切りなしは後ろ）
 * 3. 締め切りが同じなら優先度が高い順
 * 4. それも同じなら作成が古い順
 * （緊急同士も 2〜4 のルールで並べる）
 */
function compareTasks(a: Task, b: Task): number {
	const aUrgent = a.priority === "urgent" ? 1 : 0;
	const bUrgent = b.priority === "urgent" ? 1 : 0;
	if (aUrgent !== bUrgent) return bUrgent - aUrgent;

	if (a.deadline && b.deadline) {
		const diff = daysUntil(a.deadline) - daysUntil(b.deadline);
		if (diff !== 0) return diff;
	} else if (a.deadline && !b.deadline) {
		return -1;
	} else if (!a.deadline && b.deadline) {
		return 1;
	}

	const pDiff = PRIORITY_WEIGHT[b.priority] - PRIORITY_WEIGHT[a.priority];
	if (pDiff !== 0) return pDiff;

	return a.createdAt - b.createdAt;
}

interface LevelInfo {
	level: number;
	/** 現レベル内で積み上げた完了数 */
	current: number;
	/** 次のレベルまでに必要な完了数（現レベル内） */
	required: number;
}

/**
 * レベル計算: Lv0→1 は 10 件、Lv1→2 は 11 件、Lv2→3 は 12 件…と 1 件ずつ増える
 */
function levelInfo(completed: number): LevelInfo {
	let level = 0;
	let remaining = completed;
	while (remaining >= 10 + level) {
		remaining -= 10 + level;
		level++;
	}
	return { level, current: remaining, required: 10 + level };
}

/* =========================================================
 * プラグイン本体
 * ======================================================= */

export default class TaskQuestPlugin extends Plugin {
	data: TaskQuestData = { ...DEFAULT_DATA, tasks: [] };

	async onload() {
		await this.loadPluginData();

		this.registerView(VIEW_TYPE_TASK_QUEST, (leaf) => new TaskQuestView(leaf, this));

		this.addRibbonIcon("list-checks", "Task Quest を開く", () => {
			this.activateView();
		});

		this.addCommand({
			id: "open-task-quest",
			name: "タスク一覧を開く",
			callback: () => this.activateView(),
		});

		this.addCommand({
			id: "add-task",
			name: "新しいタスクを追加",
			callback: () => this.openTaskForm(null),
		});
	}

	onunload() {
		// ビューは Obsidian が自動で片付ける
	}

	async loadPluginData() {
		const loaded = (await this.loadData()) as Partial<TaskQuestData> | null;
		this.data = {
			tasks: Array.isArray(loaded?.tasks) ? loaded!.tasks : [],
			completedCount: typeof loaded?.completedCount === "number" ? loaded!.completedCount : 0,
		};
	}

	async savePluginData() {
		await this.saveData(this.data);
	}

	async activateView() {
		const { workspace } = this.app;
		let leaf: WorkspaceLeaf | null = workspace.getLeavesOfType(VIEW_TYPE_TASK_QUEST)[0] ?? null;
		if (!leaf) {
			leaf = workspace.getRightLeaf(false) ?? workspace.getLeaf(true);
			await leaf.setViewState({ type: VIEW_TYPE_TASK_QUEST, active: true });
		}
		workspace.revealLeaf(leaf);
	}

	/** 開いている全ての Task Quest ビューを再描画 */
	refreshViews() {
		for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_TASK_QUEST)) {
			const view = leaf.view;
			if (view instanceof TaskQuestView) view.render();
		}
	}

	openTaskForm(task: Task | null) {
		new TaskFormModal(this.app, task, async (result) => {
			if (task) {
				const idx = this.data.tasks.findIndex((t) => t.id === task.id);
				if (idx >= 0) this.data.tasks[idx] = result;
			} else {
				this.data.tasks.push(result);
			}
			await this.savePluginData();
			// 編集の結果、全サブタスクが完了状態になったら完了扱いにする
			if (result.subtasks.length > 0 && result.subtasks.every((s) => s.done)) {
				await this.completeTask(result.id);
			} else {
				this.refreshViews();
			}
		}).open();
	}

	async toggleSubtask(taskId: string, subtaskId: string, done: boolean) {
		const task = this.data.tasks.find((t) => t.id === taskId);
		if (!task) return;
		const sub = task.subtasks.find((s) => s.id === subtaskId);
		if (!sub) return;
		sub.done = done;
		await this.savePluginData();
		if (task.subtasks.length > 0 && task.subtasks.every((s) => s.done)) {
			await this.completeTask(taskId);
		} else {
			this.refreshViews();
		}
	}

	async completeTask(taskId: string) {
		const task = this.data.tasks.find((t) => t.id === taskId);
		if (!task) return;
		const before = levelInfo(this.data.completedCount).level;
		this.data.tasks = this.data.tasks.filter((t) => t.id !== taskId);
		this.data.completedCount++;
		await this.savePluginData();
		const after = levelInfo(this.data.completedCount).level;
		this.refreshViews();
		new CompleteModal(this.app, task.title, after > before ? after : null).open();
	}

	deleteTask(task: Task) {
		new ConfirmModal(this.app, `「${task.title}」を削除しますか？\nこの操作は取り消せません。`, async () => {
			this.data.tasks = this.data.tasks.filter((t) => t.id !== task.id);
			await this.savePluginData();
			this.refreshViews();
			new Notice("タスクを削除しました");
		}).open();
	}
}

/* =========================================================
 * サイドバー / タブ用ビュー
 * ======================================================= */

class TaskQuestView extends ItemView {
	plugin: TaskQuestPlugin;

	constructor(leaf: WorkspaceLeaf, plugin: TaskQuestPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return VIEW_TYPE_TASK_QUEST;
	}

	getDisplayText(): string {
		return "Task Quest";
	}

	getIcon(): string {
		return "list-checks";
	}

	async onOpen() {
		this.render();
	}

	async onClose() {
		this.contentEl.empty();
	}

	render() {
		const root = this.contentEl;
		root.empty();
		root.addClass("tq-root");

		this.renderHeader(root);

		const tasks = [...this.plugin.data.tasks].sort(compareTasks);
		const list = root.createDiv({ cls: "tq-list" });
		if (tasks.length === 0) {
			list.createDiv({ cls: "tq-empty", text: "タスクはまだありません。「＋ タスクを追加」から始めましょう！" });
			return;
		}
		for (const task of tasks) this.renderCard(list, task);
	}

	private renderHeader(root: HTMLElement) {
		const header = root.createDiv({ cls: "tq-header" });

		const info = levelInfo(this.plugin.data.completedCount);
		const levelBox = header.createDiv({ cls: "tq-level" });
		const top = levelBox.createDiv({ cls: "tq-level-top" });
		top.createSpan({ cls: "tq-level-badge", text: `Lv ${info.level}` });
		top.createSpan({ cls: "tq-level-total", text: `完了したタスク: ${this.plugin.data.completedCount}件` });

		const bar = levelBox.createDiv({ cls: "tq-bar tq-level-bar" });
		const fill = bar.createDiv({ cls: "tq-bar-fill" });
		fill.style.width = `${(info.current / info.required) * 100}%`;
		levelBox.createDiv({
			cls: "tq-level-next",
			text: `次のレベルまで ${info.current} / ${info.required}（あと${info.required - info.current}件）`,
		});

		const addBtn = header.createEl("button", { cls: "tq-btn tq-btn-primary tq-add-btn", text: "＋ タスクを追加" });
		addBtn.addEventListener("click", () => this.plugin.openTaskForm(null));
	}

	private renderCard(parent: HTMLElement, task: Task) {
		const card = parent.createDiv({ cls: "tq-card" });
		card.addClass(`tq-priority-${task.priority}`);
		if (task.priority === "urgent") card.addClass("tq-card-urgent");

		// ヘッダー行: 優先度バッジ・タイトル・操作ボタン
		const head = card.createDiv({ cls: "tq-card-head" });
		head.createSpan({ cls: `tq-badge tq-badge-${task.priority}`, text: PRIORITY_LABEL[task.priority] });
		head.createDiv({ cls: "tq-card-title", text: task.title });

		const actions = head.createDiv({ cls: "tq-card-actions" });
		const editBtn = actions.createEl("button", { cls: "tq-icon-btn", attr: { "aria-label": "編集" } });
		setIcon(editBtn, "pencil");
		editBtn.addEventListener("click", () => this.plugin.openTaskForm(task));
		const delBtn = actions.createEl("button", { cls: "tq-icon-btn tq-icon-btn-danger", attr: { "aria-label": "削除" } });
		setIcon(delBtn, "trash-2");
		delBtn.addEventListener("click", () => this.plugin.deleteTask(task));

		// 締め切り
		if (task.deadline) {
			const dl = card.createDiv({ cls: "tq-deadline", text: `締め切り: ${deadlineLabel(task.deadline)}` });
			if (daysUntil(task.deadline) <= DEADLINE_WARNING_DAYS) dl.addClass("tq-deadline-near");
		} else {
			card.createDiv({ cls: "tq-deadline tq-deadline-none", text: "締め切り: なし" });
		}

		// 概要
		if (task.description.trim()) {
			card.createDiv({ cls: "tq-desc", text: task.description });
		}

		// タスク分解（チェックボックス）
		if (task.subtasks.length > 0) {
			const ul = card.createDiv({ cls: "tq-subtasks" });
			for (const sub of task.subtasks) {
				const row = ul.createEl("label", { cls: "tq-subtask" });
				const cb = row.createEl("input", { type: "checkbox" });
				cb.checked = sub.done;
				cb.addEventListener("change", () => {
					this.plugin.toggleSubtask(task.id, sub.id, cb.checked);
				});
				const span = row.createSpan({ text: sub.text });
				if (sub.done) span.addClass("tq-subtask-done");
			}

			// 進捗ゲージ
			const pct = progressOf(task);
			const prog = card.createDiv({ cls: "tq-progress" });
			const bar = prog.createDiv({ cls: "tq-bar" });
			const fill = bar.createDiv({ cls: "tq-bar-fill" });
			fill.style.width = `${pct}%`;
			prog.createSpan({ cls: "tq-progress-text", text: `${pct}%` });
		} else {
			// サブタスクがない場合は完了ボタン
			const doneBtn = card.createEl("button", { cls: "tq-btn tq-btn-primary tq-done-btn", text: "✓ 完了" });
			doneBtn.addEventListener("click", () => this.plugin.completeTask(task.id));
		}
	}
}

/* =========================================================
 * タスク入力フォーム（追加・編集）
 * ======================================================= */

interface SubtaskRow {
	id: string | null;
	input: HTMLInputElement;
}

class TaskFormModal extends Modal {
	private original: Task | null;
	private onSubmit: (task: Task) => void | Promise<void>;
	private rows: SubtaskRow[] = [];

	constructor(app: App, original: Task | null, onSubmit: (task: Task) => void | Promise<void>) {
		super(app);
		this.original = original;
		this.onSubmit = onSubmit;
	}

	onOpen() {
		const { contentEl } = this;
		this.modalEl.addClass("tq-modal");
		contentEl.empty();
		contentEl.createEl("h2", { text: this.original ? "タスクを編集" : "新しいタスク" });

		const form = contentEl.createDiv({ cls: "tq-form" });

		// タイトル
		const titleField = this.field(form, "タイトル（必須）");
		const titleInput = titleField.createEl("input", { type: "text", cls: "tq-input" });
		titleInput.placeholder = "例: 企画書を仕上げる";
		titleInput.value = this.original?.title ?? "";

		// 概要
		const descField = this.field(form, "概要");
		const descInput = descField.createEl("textarea", { cls: "tq-input tq-textarea" });
		descInput.placeholder = "タスクの説明やメモ";
		descInput.value = this.original?.description ?? "";

		// タスク分解
		const subField = this.field(form, "タスク分解");
		const subList = subField.createDiv({ cls: "tq-sub-rows" });
		const addRow = (text: string, id: string | null) => {
			const rowEl = subList.createDiv({ cls: "tq-sub-row" });
			const input = rowEl.createEl("input", { type: "text", cls: "tq-input" });
			input.placeholder = "やること";
			input.value = text;
			const row: SubtaskRow = { id, input };
			const rm = rowEl.createEl("button", { cls: "tq-icon-btn tq-icon-btn-danger", attr: { "aria-label": "この行を削除" } });
			setIcon(rm, "x");
			rm.addEventListener("click", (e) => {
				e.preventDefault();
				this.rows = this.rows.filter((r) => r !== row);
				rowEl.remove();
			});
			input.addEventListener("keydown", (e) => {
				if (e.key === "Enter" && !e.isComposing) {
					e.preventDefault();
					const newRow = addRow("", null);
					newRow.input.focus();
				}
			});
			this.rows.push(row);
			return row;
		};
		if (this.original && this.original.subtasks.length > 0) {
			for (const s of this.original.subtasks) addRow(s.text, s.id);
		} else {
			addRow("", null);
		}
		const addSubBtn = subField.createEl("button", { cls: "tq-btn tq-btn-secondary", text: "＋ 項目を追加" });
		addSubBtn.addEventListener("click", (e) => {
			e.preventDefault();
			addRow("", null).input.focus();
		});

		// 優先順位
		const prioField = this.field(form, "優先順位");
		const prioSelect = prioField.createEl("select", { cls: "tq-input dropdown" });
		(["low", "medium", "high", "urgent"] as Priority[]).forEach((p) => {
			prioSelect.createEl("option", { value: p, text: PRIORITY_LABEL[p] });
		});
		prioSelect.value = this.original?.priority ?? "medium";

		// 締め切り
		const dlField = this.field(form, "締め切り");
		const dlInput = dlField.createEl("input", { type: "date", cls: "tq-input" });
		dlInput.value = this.original?.deadline ?? "";

		// ボタン
		const btns = contentEl.createDiv({ cls: "tq-modal-buttons" });
		const cancel = btns.createEl("button", { cls: "tq-btn tq-btn-secondary", text: "キャンセル" });
		cancel.addEventListener("click", () => this.close());
		const save = btns.createEl("button", { cls: "tq-btn tq-btn-primary", text: this.original ? "保存" : "追加" });
		save.addEventListener("click", async () => {
			const title = titleInput.value.trim();
			if (!title) {
				new Notice("タイトルを入力してください");
				titleInput.focus();
				return;
			}
			const subtasks: Subtask[] = [];
			for (const r of this.rows) {
				const text = r.input.value.trim();
				if (!text) continue;
				// 既存の項目で文字が変わっていなければチェック状態を引き継ぐ
				const prev = r.id ? this.original?.subtasks.find((s) => s.id === r.id) : undefined;
				subtasks.push({
					id: prev?.id ?? genId(),
					text,
					done: prev ? prev.text === text && prev.done : false,
				});
			}
			const task: Task = {
				id: this.original?.id ?? genId(),
				title,
				description: descInput.value,
				subtasks,
				priority: prioSelect.value as Priority,
				deadline: dlInput.value || null,
				createdAt: this.original?.createdAt ?? Date.now(),
			};
			this.close();
			await this.onSubmit(task);
		});

		window.setTimeout(() => titleInput.focus(), 0);
	}

	private field(parent: HTMLElement, label: string): HTMLElement {
		const f = parent.createDiv({ cls: "tq-field" });
		f.createEl("label", { cls: "tq-label", text: label });
		return f;
	}

	onClose() {
		this.contentEl.empty();
	}
}

/* =========================================================
 * 「タスク完了！」ポップアップ
 * ======================================================= */

class CompleteModal extends Modal {
	private title: string;
	private newLevel: number | null;
	private timer: number | null = null;

	constructor(app: App, title: string, newLevel: number | null) {
		super(app);
		this.title = title;
		this.newLevel = newLevel;
	}

	onOpen() {
		this.modalEl.addClass("tq-modal", "tq-complete-modal");
		const { contentEl } = this;
		contentEl.empty();
		const box = contentEl.createDiv({ cls: "tq-complete" });
		box.createDiv({ cls: "tq-complete-icon", text: "🎉" });
		box.createDiv({ cls: "tq-complete-title", text: "タスク完了！" });
		box.createDiv({ cls: "tq-complete-sub", text: this.title });
		if (this.newLevel !== null) {
			box.createDiv({ cls: "tq-levelup", text: `⬆ レベルアップ！ Lv ${this.newLevel} になりました` });
		}
		const ok = box.createEl("button", { cls: "tq-btn tq-btn-primary", text: "OK" });
		ok.addEventListener("click", () => this.close());

		// レベルアップ時は少し長めに表示してから自動で閉じる
		this.timer = window.setTimeout(() => this.close(), this.newLevel !== null ? 5000 : 2500);
	}

	onClose() {
		if (this.timer !== null) window.clearTimeout(this.timer);
		this.contentEl.empty();
	}
}

/* =========================================================
 * 削除確認ダイアログ
 * ======================================================= */

class ConfirmModal extends Modal {
	private message: string;
	private onConfirm: () => void | Promise<void>;

	constructor(app: App, message: string, onConfirm: () => void | Promise<void>) {
		super(app);
		this.message = message;
		this.onConfirm = onConfirm;
	}

	onOpen() {
		this.modalEl.addClass("tq-modal");
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl("h3", { text: "確認" });
		contentEl.createDiv({ cls: "tq-confirm-msg", text: this.message });
		const btns = contentEl.createDiv({ cls: "tq-modal-buttons" });
		const cancel = btns.createEl("button", { cls: "tq-btn tq-btn-secondary", text: "キャンセル" });
		cancel.addEventListener("click", () => this.close());
		const ok = btns.createEl("button", { cls: "tq-btn tq-btn-danger", text: "削除する" });
		ok.addEventListener("click", async () => {
			this.close();
			await this.onConfirm();
		});
	}

	onClose() {
		this.contentEl.empty();
	}
}
