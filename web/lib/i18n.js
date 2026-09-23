import { weekdayIndex } from './period.js';

export const DEFAULT_LOCALE = 'zh-CN';
export const LOCALES = ['zh-CN', 'en'];

// Monday-first, matching the calendar grids.
export const WEEKDAYS = {
  'zh-CN': ['一', '二', '三', '四', '五', '六', '日'],
  en: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
};

export const MONTHS = {
  'zh-CN': ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'],
  en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
};

const MONTHS_LONG_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// Exported for the key-parity test (test/i18n.test.js): zh-CN and en must
// carry exactly the same key set, or t()'s fallback would silently show
// Chinese strings to EN users (and vice versa).
export const tables = {
  'zh-CN': {
    docTitle: 'toksight · Token 用量与成本报告',
    toolbarAria: '报告设置',
    modeGroup: '统计周期',
    modeMonth: '月',
    modeYear: '年',
    prev: '上一期',
    next: '下一期',
    themeGroup: '配色',
    themeLight: '浅色',
    themeDark: '深色',
    themeSystem: '跟随系统',
    langGroup: '界面语言',
    refresh: '刷新数据库',
    refreshing: '正在刷新数据库',
    refreshFailed: '刷新数据库失败：{error}',
    exportImage: '导出图片',
    exporting: '导出中…',
    exportFailed: '导出图片失败：{error}',
    eyebrow: 'Token 用量与成本报告',
    heroRange: '{since} – {until}',
    heroAsOf: '统计至 {date}',
    heroAgents: '{n} 个 agent',
    heroAgentsOne: '{n} 个 agent',
    heroModels: '{n} 个模型',
    heroModelsOne: '{n} 个模型',
    kpiTokens: 'Tokens',
    kpiTokensSub: '输入 {input} · 输出 {output}',
    kpiCost: '参考费用',
    kpiCostAll: '所有请求均已定价',
    kpiCostUnpriced: '{n} 个模型未定价',
    kpiCache: '缓存命中率',
    kpiCacheSub: '缓存读取 {tokens}',
    kpiRequests: '请求',
    kpiRequestsSub: '{n} 个会话',
    kpiRequestsSubOne: '{n} 个会话',
    metricGroup: '指标',
    metricTokens: 'Tokens',
    metricCost: '费用',
    dragHandle: '拖动调整卡片顺序（也可用 ↑ ↓ 键）',
    cardHeat: '活动热力图',
    cardAgents: 'Agent 分布',
    cardModels: '模型分布',
    subHeatTokens: '{period} · 每日 Tokens',
    subHeatCost: '{period} · 每日费用',
    subRankTokens: '{period} · 按 Tokens 排序',
    subRankCost: '{period} · 按费用排序',
    statActive: '活跃天数',
    statActiveValue: '{n} / {total} 天',
    statAverage: '活跃日均',
    statPeak: '峰值日',
    statStreak: '最长连续',
    statStreakValue: '{n} 天',
    statStreakValueOne: '{n} 天',
    heatLess: '少',
    heatMore: '多',
    heatAria: '{period}每日热力图',
    tipTokens: 'Tokens',
    tipCost: '费用',
    tipRequests: '请求 / 会话',
    tipCache: '缓存命中',
    tipIdle: '无活动',
    tipFuture: '尚未到来',
    compInput: '输入',
    compCacheRead: '缓存读',
    compCacheWrite: '缓存写',
    compOutput: '输出',
    rowCache: '缓存命中 {pct}',
    rowRequests: '{n} 请求',
    rowRequestsOne: '{n} 请求',
    rowSessions: '{n} 会话',
    rowSessionsOne: '{n} 会话',
    rowUnpriced: '未定价',
    rowPartial: '部分未定价',
    rowAgents: '经 {agents}',
    others: '其他 {n} 个模型',
    emptyPeriod: '这个周期没有记录。',
    loading: '正在读取本地数据库…',
    errorTitle: '无法加载数据',
    errorBody: '`/api/data` 请求失败：{error}',
    errorHint: '请通过 `toksight web` 打开本页面；开发时运行 `npm run web:dev`。',
    retry: '重试',
    emptyTitle: '还没有任何会话记录',
    emptyBody: '先用 AI agent 跑几个会话，再点击刷新数据库。终端运行 `toksight env` 可以查看各 agent 的扫描位置。',
    warnings: '{n} 条采集警告',
    footGenerated: '生成于 {time}',
    footRefreshed: '数据刷新于 {time}',
    footTimezone: '时区 {tz}',
    footEstimate: '费用按公开价格估算，仅供参考',
    footLocal: '数据只来自本机会话文件',
    footUnpriced: '未定价模型：{models}',
    dayHint: '点击日期查看当天详情',
    dayPanel: '单日详情',
    dayPrev: '前一天',
    dayNext: '后一天',
    dayClose: '关闭详情',
    dayToday: '今天',
    dayEmpty: '这一天没有记录。',
    secHourly: '时段分布',
    secSessions: '会话',
    hourlyPeak: '峰值 {hour}',
    hourlyAria: '{day}每小时分布',
    sessionsAll: '按 Tokens 排序 · 共 {n} 个',
    sessionsAllOne: '按 Tokens 排序 · 共 {n} 个',
    sessionsTop: '按 Tokens 排序 · 前 {shown} 个 / 共 {n} 个',
    sessionActive: '活跃 {time}',
    sessionUntitled: '未命名会话',
  },
  en: {
    docTitle: 'toksight · Token usage & cost report',
    toolbarAria: 'Report settings',
    modeGroup: 'Period',
    modeMonth: 'Month',
    modeYear: 'Year',
    prev: 'Previous period',
    next: 'Next period',
    themeGroup: 'Theme',
    themeLight: 'Light',
    themeDark: 'Dark',
    themeSystem: 'System',
    langGroup: 'Language',
    refresh: 'Refresh database',
    refreshing: 'Refreshing database',
    refreshFailed: 'Database refresh failed: {error}',
    exportImage: 'Export image',
    exporting: 'Exporting…',
    exportFailed: 'Image export failed: {error}',
    eyebrow: 'Token usage & cost report',
    heroRange: '{since} – {until}',
    heroAsOf: 'as of {date}',
    heroAgents: '{n} agents',
    heroAgentsOne: '{n} agent',
    heroModels: '{n} models',
    heroModelsOne: '{n} model',
    kpiTokens: 'Tokens',
    kpiTokensSub: 'input {input} · output {output}',
    kpiCost: 'Estimated cost',
    kpiCostAll: 'every request priced',
    kpiCostUnpriced: '{n} models unpriced',
    kpiCache: 'Cache hit rate',
    kpiCacheSub: '{tokens} cache reads',
    kpiRequests: 'Requests',
    kpiRequestsSub: '{n} sessions',
    kpiRequestsSubOne: '{n} session',
    metricGroup: 'Metric',
    metricTokens: 'Tokens',
    metricCost: 'Cost',
    dragHandle: 'Drag to reorder cards (or use ↑ ↓ keys)',
    cardHeat: 'Activity heatmap',
    cardAgents: 'By agent',
    cardModels: 'By model',
    subHeatTokens: '{period} · daily tokens',
    subHeatCost: '{period} · daily cost',
    subRankTokens: '{period} · ranked by tokens',
    subRankCost: '{period} · ranked by cost',
    statActive: 'Active days',
    statActiveValue: '{n} / {total} days',
    statAverage: 'Per active day',
    statPeak: 'Peak day',
    statStreak: 'Longest streak',
    statStreakValue: '{n} days',
    statStreakValueOne: '{n} day',
    heatLess: 'Less',
    heatMore: 'More',
    heatAria: 'Daily heatmap for {period}',
    tipTokens: 'Tokens',
    tipCost: 'Cost',
    tipRequests: 'Requests / sessions',
    tipCache: 'Cache hit',
    tipIdle: 'No activity',
    tipFuture: 'Not yet',
    compInput: 'Input',
    compCacheRead: 'Cache read',
    compCacheWrite: 'Cache write',
    compOutput: 'Output',
    rowCache: '{pct} cache hit',
    rowRequests: '{n} requests',
    rowRequestsOne: '{n} request',
    rowSessions: '{n} sessions',
    rowSessionsOne: '{n} session',
    rowUnpriced: 'unpriced',
    rowPartial: 'partly unpriced',
    rowAgents: 'via {agents}',
    others: '{n} other models',
    emptyPeriod: 'Nothing recorded in this period.',
    loading: 'Reading local database…',
    errorTitle: 'Could not load data',
    errorBody: '`/api/data` request failed: {error}',
    errorHint: 'Open this page through `toksight web`; for development run `npm run web:dev`.',
    retry: 'Retry',
    emptyTitle: 'No sessions recorded yet',
    emptyBody: 'Run a few sessions with your AI agents, then refresh the database. `toksight env` in a terminal shows where each agent is scanned.',
    warnings: '{n} collection warnings',
    footGenerated: 'Generated {time}',
    footRefreshed: 'Data refreshed {time}',
    footTimezone: 'Timezone {tz}',
    footEstimate: 'Costs are estimates from public prices',
    footLocal: 'Data comes only from this machine',
    footUnpriced: 'Unpriced models: {models}',
    dayHint: 'Click a day for its details',
    dayPanel: 'Day detail',
    dayPrev: 'Previous day',
    dayNext: 'Next day',
    dayClose: 'Close details',
    dayToday: 'Today',
    dayEmpty: 'Nothing recorded on this day.',
    secHourly: 'By hour',
    secSessions: 'Sessions',
    hourlyPeak: 'peak {hour}',
    hourlyAria: 'Hourly breakdown for {day}',
    sessionsAll: 'by tokens · {n} sessions',
    sessionsAllOne: 'by tokens · {n} session',
    sessionsTop: 'by tokens · top {shown} of {n}',
    sessionActive: '{time} active',
    sessionUntitled: 'Untitled session',
  },
};

// A `<key>One` entry, when present, is used for `n === 1`.
export function t(locale, key, vars) {
  const table = tables[locale] ?? tables[DEFAULT_LOCALE];
  const one = vars && String(vars.n) === '1' ? table[`${key}One`] : undefined;
  let str = one ?? table[key] ?? tables[DEFAULT_LOCALE][key] ?? tables.en[key] ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) str = str.replaceAll(`{${k}}`, String(v));
  }
  return str;
}

export function periodLabel(locale, { mode, year, month }) {
  if (mode === 'year') return locale === 'en' ? String(year) : `${year} 年`;
  return locale === 'en' ? `${MONTHS_LONG_EN[month - 1]} ${year}` : `${year} 年 ${month} 月`;
}

// 'YYYY-MM-DD' → "9月12日" / "Sep 12" (with the year when asked).
export function dayLabel(locale, key, withYear = false) {
  const [y, m, d] = key.split('-').map(Number);
  if (locale === 'en') return `${MONTHS.en[m - 1]} ${d}${withYear ? `, ${y}` : ''}`;
  return `${withYear ? `${y}年` : ''}${m}月${d}日`;
}

// 'YYYY-MM-DD' → "周六" / "Sat".
export function weekdayLabel(locale, key) {
  const name = WEEKDAYS[locale === 'en' ? 'en' : 'zh-CN'][weekdayIndex(key)];
  return locale === 'en' ? name : `周${name}`;
}

// Rounded to whole minutes: "1 小时 20 分" / "1h 20m"; "<1m" below a minute.
export function durationLabel(locale, ms) {
  const minutes = Math.round((Number(ms) || 0) / 60000);
  if (minutes < 1) return locale === 'en' ? '<1m' : '不到 1 分钟';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (locale === 'en') return h ? `${h}h${m ? ` ${m}m` : ''}` : `${m}m`;
  return h ? `${h} 小时${m ? ` ${m} 分` : ''}` : `${m} 分钟`;
}
