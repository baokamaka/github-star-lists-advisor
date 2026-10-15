// ==UserScript==
// @name         GitHub Star 时推荐 Lists
// @namespace    qoder.github-star-lists-advisor
// @version      0.10.3
// @description  点 Star 时读懂这个项目，推荐该加入哪个 List；没有合适的 List 就推荐该新建哪个 List，并可一键驱动原生面板完成
// @match        https://github.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @connect      *
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  // LOGIC-BEGIN  (纯函数，不碰 DOM / GM，可单独测试)
  const STOP = new Set([
    'the', 'and', 'for', 'with', 'this', 'that', 'from', 'your', 'you', 'are', 'was', 'will', 'have', 'has',
    'not', 'but', 'can', 'its', 'our', 'out', 'get', 'set', 'one', 'two', 'new', 'old', 'all', 'any',
    'is', 'to', 'in', 'on', 'at', 'be', 'we', 'he', 'she', 'it', 'or', 'an', 'as', 'by', 'of', 'if',
    'no', 'do', 'so', 'up', 'than', 'then', 'when', 'what', 'which', 'into', 'about', 'some', 'such',
    'app', 'apps', 'tool', 'tools', 'based', 'using', 'used', 'awesome', 'list', 'lists', 'repo', 'repos',
    'use', 'uses', 'also', 'web', 'work', 'works', 'collection', 'support', 'supports', 'include', 'includes',
    'build', 'built', 'top', 'full', 'complete', 'way', 'ways', 'example', 'examples', 'something', 'things',
    'github', 'git', 'http', 'https', 'com', 'www', 'code', 'data', 'simple', 'easy', 'free', 'open',
    'source', 'project', 'projects', 'repository'
  ]);
  const GENERIC_TOPICS = new Set(['open-source', 'oss', 'app', 'apps', 'tool', 'tools', 'library', 'awesome', 'project', 'example', 'examples', 'demo', 'wrapper', 'client', 'plugin', 'alternative']);
  // 中文二元切分会产出大量万能词，跟英文停用词一样不能当归类证据
  const STOP_CJK = new Set(['使用', '应', '应用', '项目', '开发', '功能', '支持', '模块', '增强', '工具', '相关', '一个', '提供', '基于', '简单', '快速', '开源', '管理', '系统', '平台', '数据', '代码', '问题', '实现', '设计', '接口', '服务', '组件', '插件', '自动', '生成', '分析', '学习', '教程', '示例', '文档', '框架', '需要', '可', '以', '和', '与', '为', '在', '了', '是', '用', '于', '等', '最', '新', '好', '会', '能', '过', '从', '他们', '通过', '进行', '具有', '允许', '可以', '能够', '适合', '用于', '包括', '以及', '或者', '如果', '所以', '但是', '虽然']);

  function tokenize(input) {
    const out = new Set();
    const s = String(input || '').toLowerCase();
    for (const part of s.split(/[^a-z0-9一-龥-]+/)) {
      if (!part) continue;
      if (/^[a-z0-9]+$/.test(part)) {
        if (part.length >= 2 && !STOP.has(part)) out.add(part);
      } else {
        const cjk = part.replace(/[^一-龥]/g, '');
        for (let i = 0; i + 2 <= cjk.length; i++) {
          const bg = cjk.slice(i, i + 2);
          if (!STOP_CJK.has(bg)) out.add(bg);
        }
      }
    }
    return out;
  }

  function union(...sets) {
    const out = new Set();
    for (const s of sets) if (s) for (const t of s) out.add(t);
    return out;
  }

  function sharedTokens(a, b) {
    const hits = [];
    for (const t of a) if (b.has(t)) hits.push(t);
    return hits;
  }

  const ACRONYMS = { ai: 'AI', llm: 'LLM', llms: 'LLMs', api: 'API', apis: 'APIs', cli: 'CLI', ui: 'UI', ml: 'ML', oss: 'OSS', ios: 'iOS', gpt: 'GPT', gpu: 'GPU', cpu: 'CPU', nlp: 'NLP', rag: 'RAG', sdk: 'SDK', ide: 'IDE', ocr: 'OCR', tts: 'TTS', aws: 'AWS', gcp: 'GCP', vpn: 'VPN', cdn: 'CDN', db: 'DB', ci: 'CI', cd: 'CD', web: 'Web', mac: 'Mac', dev: 'Dev', bot: 'Bot' };

  function humanizeWord(w, first) {
    const fixed = ACRONYMS[w.toLowerCase()];
    if (fixed) return fixed;
    if (w !== w.toLowerCase() && /[A-Z]/.test(w.slice(1))) return w;
    return first ? w.charAt(0).toUpperCase() + w.slice(1) : w;
  }

  function humanize(topic) {
    const words = String(topic).replace(/[-_]+/g, ' ').trim().split(/\s+/).filter(Boolean);
    if (!words.length) return '';
    if (words.length === 1) return humanizeWord(words[0], false);
    return words.map((w, i) => humanizeWord(w, i === 0)).join(' ').slice(0, 32);
  }

  // 内置类别词典：仓库 topic/描述 → 规范类别，列表名/别名 → 同一类别，两边对上即强信号
  const CATEGORIES = [
    { name: 'AI / LLM', aliases: ['ai', 'llm', 'gpt', 'ml', 'ai agents', 'agent', '机器学习', '人工智能', '大模型', '智能体'], topics: ['ai', 'llm', 'ai-agents', 'ai-agent', 'agents', 'agentic', 'multiagent', 'rag', 'gpt', 'chatgpt', 'openai', 'anthropic', 'claude', 'gemini', 'generative-ai', 'diffusion', 'stable-diffusion', 'prompt', 'prompt-engineering', 'langchain', 'langgraph', 'mcp', 'transformers', 'deep-learning', 'machine-learning', 'nlp', 'computer-vision', 'fine-tuning', 'inference', 'embedding', 'vector-database', 'multimodal', 'copilot', 'llm-ops'] },
    { name: '命令行工具', aliases: ['cli', '命令行', 'terminal', '终端', 'tui', 'shell'], topics: ['cli', 'command-line', 'terminal', 'tui', 'shell', 'console-tool', 'command', 'bash', 'zsh', 'fish-shell', 'posix'] },
    { name: '前端与 UI', aliases: ['前端', 'ui', '网页', '组件库', '设计系统'], topics: ['react', 'vue', 'svelte', 'angular', 'nextjs', 'nuxt', 'css', 'tailwind', 'ui', 'ui-kit', 'ui-components', 'components', 'component-library', 'design-system', 'frontend', 'html', 'webapp', 'pwa', 'storybook'] },
    { name: '后端与框架', aliases: ['后端', 'backend', 'framework', 'api', '服务端', '微服务'], topics: ['backend', 'framework', 'rest-api', 'graphql', 'grpc', 'microservices', 'web-framework', 'http-server', 'api-server', 'server', 'sdk'] },
    { name: '数据库与存储', aliases: ['数据库', 'db', 'storage', 'sql', '存储'], topics: ['database', 'postgresql', 'mysql', 'sqlite', 'redis', 'mongodb', 'kv-store', 'orm', 'migration', 'datastore', 'object-storage', 'timeseries', 'database-schema'] },
    { name: '自托管服务', aliases: ['自托管', 'self-hosted', 'homelab', 'nas'], topics: ['self-hosted', 'selfhosted', 'homelab', 'docker', 'docker-compose', 'kubernetes', 'k8s', 'nas', 'media-server', 'jellyfin', 'home-automation', 'reverse-proxy'] },
    { name: '运维与可观测', aliases: ['运维', 'devops', '监控', 'observability', 'sre', '基础设施'], topics: ['monitoring', 'observability', 'logging', 'metrics', 'tracing', 'prometheus', 'grafana', 'opentelemetry', 'devops', 'sre', 'infrastructure', 'terraform', 'ansible', 'ci-cd', 'deployment'] },
    { name: '网络与代理', aliases: ['网络', '代理', 'proxy', 'vpn', 'dns'], topics: ['proxy', 'vpn', 'dns', 'http', 'https', 'network', 'networking', 'wireguard', 'clash', 'sing-box', 'shadowsocks', 'v2ray', 'cdn', 'tls', 'webserver'] },
    { name: '安全', aliases: ['安全', 'security', 'pentest', '渗透', '漏洞', 'osint', 'ctf'], topics: ['security', 'penetration-testing', 'pentest', 'cve', 'vulnerability', 'vulnerabilities', 'fuzzing', 'osint', 'malware', 'appsec', 'red-team', 'blue-team', 'ctf', 'encryption', 'secret-scanning', 'audit'] },
    { name: '游戏与模拟器', aliases: ['游戏', 'game', 'games', 'gaming', '模拟器', 'emulator', '复古游戏'], topics: ['game', 'games', 'gaming', 'game-engine', 'emulator', 'emulation', 'godot', 'unity', 'unreal-engine', 'retro', 'retrogaming', 'steam', 'minecraft', 'mods', 'game-development', 'roguelike'] },
    { name: '移动与桌面应用', aliases: ['客户端', '应用', '移动端', '桌面', 'android', 'ios'], topics: ['android', 'ios', 'macos', 'windows', 'linux', 'mobile', 'desktop', 'flutter', 'swiftui', 'kotlin', 'jetpack-compose', 'cross-platform', 'electron', 'app', 'native'] },
    { name: '编辑器与插件', aliases: ['编辑器', '插件', 'vscode', 'vim', 'neovim', 'ide'], topics: ['vscode', 'neovim', 'vim', 'emacs', 'jetbrains', 'editor', 'ide', 'plugin', 'extension', 'extensions', 'lsp', 'snippets'] },
    { name: '效率与笔记', aliases: ['效率', '笔记', 'productivity', 'notes', 'pkm', '待办', '工作流'], topics: ['productivity', 'notes', 'note-taking', 'pkm', 'todo', 'task-manager', 'task-management', 'obsidian', 'notion', 'time-management', 'workflow', 'automation', 'bookmark', 'reminder', 'calendar'] },
    { name: '学习与资料', aliases: ['学习', '教程', '资料', 'tutorial', 'course', 'awesome', '面试', '读书'], topics: ['tutorial', 'tutorials', 'course', 'courses', 'book', 'books', 'guide', 'guides', 'learning', 'examples', 'awesome', 'awesome-list', 'awesome-lists', 'cheatsheet', 'roadmap', 'interview', 'interview-questions', 'documentation', 'handbook', 'study'] },
    { name: '数据与爬虫', aliases: ['爬虫', '数据', 'crawler', 'scraping', '数据分析', 'etl'], topics: ['crawler', 'scraper', 'scraping', 'web-scraping', 'etl', 'data-pipeline', 'data-engineering', 'dataset', 'datasets', 'data-analysis', 'data-visualization', 'pandas', 'spark', 'airflow', 'analytics'] },
    { name: '音视频与媒体', aliases: ['音频', '视频', '音乐', 'audio', 'video', 'music', '播放器', '媒体'], topics: ['audio', 'video', 'music', 'player', 'media', 'media-player', 'streaming', 'ffmpeg', 'dsp', 'codec', 'podcast', 'subtitle', 'spotify', 'hypem', 'youtube', 'music-player', 'audio-player'] },
    { name: '图形与渲染', aliases: ['图形', '渲染', 'graphics', 'rendering', 'shader', '3d', '图像'], topics: ['graphics', 'rendering', 'renderer', 'shader', 'shaders', 'opengl', 'vulkan', 'webgl', 'wgpu', 'ray-tracing', 'raytracing', '3d', 'image-processing', 'canvas', 'animation'] },
    { name: '嵌入式与硬件', aliases: ['嵌入式', '硬件', 'iot', '单片机', '机器人', '树莓派'], topics: ['iot', 'embedded', 'embedded-systems', 'arduino', 'raspberry-pi', 'microcontroller', 'mcu', 'firmware', 'hardware', 'robotics', 'robot', 'esp32', 'stm32', 'rtos'] },
    { name: '区块链与加密资产', aliases: ['区块链', 'blockchain', 'web3', '加密货币', '合约'], topics: ['blockchain', 'crypto', 'cryptocurrency', 'web3', 'ethereum', 'solidity', 'wallet', 'defi', 'bitcoin', 'smart-contract', 'nft', 'token'] },
    { name: '字体与美化', aliases: ['字体', '主题', '美化', 'dotfiles', 'icons'], topics: ['font', 'fonts', 'typeface', 'theme', 'themes', 'dotfiles', 'wallpaper', 'ricing', 'icons', 'color-scheme', 'colorscheme', 'terminal-fonts'] },
    { name: '语言与运行时', aliases: ['编译器', '解释器', '语言', 'runtime', 'wasm'], topics: ['compiler', 'interpreter', 'parser', 'ast', 'language', 'programming-language', 'runtime', 'vm', 'transpiler', 'wasm', 'webassembly', 'bytecode', 'lexer'] }
  ];
  const CATCHALL = ['other', 'others', 'misc', 'miscellaneous', 'stuff', 'inbox', 'default', 'unsorted', '未分类', '杂项', '其他', '暂存', '待整理'];

  // 内置类别的英文名，用于"用户列表名是英文时，新建建议也给英文名"
  const CATEGORY_EN = {
    'AI / LLM': 'AI & LLM', '命令行工具': 'CLI Tools', '前端与 UI': 'Frontend & UI', '后端与框架': 'Backend & Frameworks',
    '数据库与存储': 'Databases & Storage', '自托管服务': 'Self-hosted', '运维与可观测': 'Ops & Observability',
    '网络与代理': 'Networking & Proxy', '安全': 'Security', '游戏与模拟器': 'Games & Emulators',
    '移动与桌面应用': 'Apps', '编辑器与插件': 'Editors & Plugins', '效率与笔记': 'Productivity & Notes',
    '学习与资料': 'Learning Resources', '数据与爬虫': 'Data & Scraping', '音视频与媒体': 'Audio & Video',
    '图形与渲染': 'Graphics & Rendering', '嵌入式与硬件': 'Embedded & Hardware', '区块链与加密资产': 'Blockchain & Crypto',
    '字体与美化': 'Themes & Dotfiles', '语言与运行时': 'Languages & Runtimes'
  };

  // 从现有列表名学命名风格：中/英、大小写、多词分隔符；lang 可被用户显式覆盖
  function namingStyle(names, forcedLang) {
    const list = (names || []).map(n => String(n || '').trim()).filter(Boolean);
    if (!list.length) return { lang: forcedLang || 'zh', casing: 'as-is', sep: ' ' };
    const cjk = list.filter(n => /[一-龥]/.test(n)).length;
    const lang = forcedLang && forcedLang !== 'auto' ? forcedLang : (cjk * 2 >= list.length ? 'zh' : 'en');
    const ascii = list.filter(n => !/[一-龥]/.test(n));
    const cnt = { lower: 0, upper: 0, title: 0 };
    for (const n of ascii) {
      if (n === n.toUpperCase() && /[A-Z]/.test(n)) cnt.upper++;
      else if (n === n.toLowerCase() && /[a-z]/.test(n)) cnt.lower++;
      else if (/^[A-Z]/.test(n)) cnt.title++;
    }
    const ranked = Object.entries(cnt).sort((a, b) => b[1] - a[1]);
    const casing = ascii.length && ranked[0][1] > ascii.length / 2 ? ranked[0][0] : 'as-is';
    const multi = ascii.filter(n => /[-\s]/.test(n));
    const sep = multi.length && multi.filter(n => n.includes('-')).length * 2 >= multi.length ? '-' : ' ';
    return { lang, casing, sep };
  }

  function categoryName(cat, style) {
    if (style.lang === 'zh') return cat;
    let s = (CATEGORY_EN[cat] || cat).replace(/[\s-]+/g, style.sep).trim();
    if (style.casing === 'lower') s = s.toLowerCase();
    else if (style.casing === 'upper') s = s.toUpperCase();
    else if (style.casing === 'title') s = s.split(style.sep).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(style.sep);
    return s.slice(0, 32);
  }

  const CAT_BY_TOPIC = new Map();
  CATEGORIES.forEach(c => c.topics.forEach(t => { if (!CAT_BY_TOPIC.has(t)) CAT_BY_TOPIC.set(t, c.name); }));

  function mentions(hay, word) {
    const s = String(hay || '');
    const w = String(word || '');
    if (!w) return false;
    if (/[^\x00-\x7f]/.test(w)) return s.toLowerCase().includes(w.toLowerCase());
    const esc = w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp('(^|[^a-z0-9])' + esc + '($|[^a-z0-9])', 'i').test(s);
  }

  // 仓库命中了哪些类别，以及命中的证据词
  function repoCategories(repo) {
    const out = new Map();
    const add = (cat, ev, w) => {
      const e = out.get(cat) || { weight: 0, hits: [] };
      e.weight += w;
      if (ev && !e.hits.includes(ev)) e.hits.push(ev);
      out.set(cat, e);
    };
    for (const t of (repo.topics || [])) {
      const c = CAT_BY_TOPIC.get(String(t).toLowerCase());
      if (c) add(c, t, 2);
    }
    const hay = [repo.description, repo.name, (repo.readme || '').slice(0, 400)].filter(Boolean).join(' ');
    for (const c of CATEGORIES) for (const a of c.aliases) if (a.length > 2 && mentions(hay, a)) add(c.name, a, 1);
    return out;
  }

  function aliasHitsIn(hay) {
    const m = new Map();
    for (const c of CATEGORIES) {
      let n = 0;
      for (const a of c.aliases) if (mentions(hay, a)) n++;
      if (n) m.set(c.name, n);
    }
    return m;
  }

  // 名称优先：只看描述会让 "Android 播放器" 这种描述把 "音视频与媒体" 误判成移动类
  function listCategory(list) {
    for (const hay of [list.name, list.description]) {
      const hits = aliasHitsIn(String(hay || ''));
      if (hits.size) return [...hits.entries()].sort((a, b) => b[1] - a[1])[0][0];
    }
    const t = tokenize([list.name, list.description].filter(Boolean).join(' '));
    for (const c of CATEGORIES) for (const tp of c.topics) if (t.has(tp)) return c.name;
    return null;
  }

  function isCatchAll(name) { return CATCHALL.some(w => mentions(name, w)); }

  // 从一段文本（列表内容的语料）反推它偏哪些内置类别
  function categoriesFromText(text) {
    return repoCategories({ name: '', description: String(text || '').slice(0, 6000), topics: [], readme: '' });
  }

  // 给每个已有列表打分。score 0..1，reasons 是可展示的依据
  function scoreLists(repo, lists) {
    const tTopics = tokenize((repo.topics || []).join(' '));
    const tDesc = tokenize(repo.description);
    const tName = tokenize(repo.name);
    const tReadme = tokenize((repo.readme || '').slice(0, 1500));
    const tAll = union(tTopics, tDesc, tName);
    const repoCats = repoCategories(repo);
    // 在很多列表里都出现的词没有区分度（web/use/files 之类），不能当证据
    const vocabs = (lists || []).map(l => l.vocabTokens || new Set());
    const df = new Map();
    for (const v of vocabs) for (const t of v) df.set(t, (df.get(t) || 0) + 1);
    // 一个词只要出现在两个及以上列表的内容里，就没有区分度（catch-all 列表会把它冲淡）
    const minDf = 2;

    return (lists || []).map(list => {
      const lName = tokenize(list.name);
      const lDesc = tokenize(list.description);
      const lVocab = list.vocabTokens || new Set();
      const reasons = [];
      let raw = 0;

      const inName = sharedTokens(tTopics, lName);
      if (inName.length) { raw += 3 * inName.length; reasons.push('topics 命中列表名：' + inName.join('、')); }

      const descInName = sharedTokens(tDesc, lName);
      if (descInName.length) { raw += 2 * descInName.length; reasons.push('描述命中列表名：' + descInName.join('、')); }

      const inListDesc = sharedTokens(union(tTopics, tDesc), lDesc);
      if (inListDesc.length) { raw += 1.5 * inListDesc.length; reasons.push('命中列表描述：' + inListDesc.join('、')); }

      const inVocab = sharedTokens(tAll, lVocab).concat(sharedTokens(tReadme, lVocab));
      const uniqVocab = [...new Set(inVocab)].filter(t => (df.get(t) || 0) < minDf);
      if (uniqVocab.length) { raw += Math.min(uniqVocab.length, 4) * 0.8; reasons.push('与列表内项目共用词：' + uniqVocab.slice(0, 4).join('、')); }

      if (tName.size && lName.size && sharedTokens(tName, lName).length) { raw += 2; reasons.push('仓库名与列表名同词'); }

      // 类别词典：同类强加，异类压到四成；兜底列表单独标记
      const category = listCategory(list);
      const catchAll = isCatchAll(list.name);
      // 自学习：不靠我内置的别名表，而从"这个列表里已经装了哪些仓库"反推它的口味
      const learned = (list.learned || []).filter(c => repoCats.has(c));
      if (learned.length) {
        raw += 3 + Math.min(learned.length, 3) * 0.6;
        reasons.push('该列表已有内容也偏「' + learned.join('、') + '」类（自学习匹配）');
      }
      if (category && repoCats.has(category)) {
        const ev = repoCats.get(category);
        raw += 4 + Math.min(ev.weight, 4) * 0.5;
        reasons.unshift('同属「' + category + '」类' + (ev.hits.length ? '（命中 ' + ev.hits.slice(0, 3).join('、') + '）' : ''));
      } else if (category && !learned.length) {
        raw *= 0.4;
        if (reasons.length) reasons.push('但该列表偏「' + category + '」类');
      }

      return { list, score: Math.min(1, raw / 6), reasons, category, catchAll };
    }).sort((a, b) => b.score - a.score);
  }

  // 从描述里挑专有名词当备选列表名（首词和仓库名本身不算，保留原大小写如 SteamOS）
  function properNouns(description, repoName) {
    const repoLow = String(repoName || '').toLowerCase();
    const out = [];
    String(description || '').split(/[^A-Za-z0-9+._-]+/).forEach((w, i) => {
      if (i === 0 || !/^[A-Z][A-Za-z0-9+._-]{1,}$/.test(w)) return;
      const low = w.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (!low || low.length < 2 || STOP.has(low) || low === repoLow) return;
      if (!out.includes(w)) out.push(w);
    });
    return out.slice(0, 3);
  }

  // 规则版建议：优先归入已有列表，分数不够则建议新建
  function ruleSuggest(repo, scored, opts) {
    const threshold = opts.threshold;
    const max = opts.maxSuggestions;
    const canCreate = opts.canCreateList !== false;

    // 兜底列表（Other / 杂项）不算推荐结果，否则会强化垃圾抽屉
    const existing = scored.filter(s => !s.list.repoIncluded && !s.catchAll && s.score >= threshold).slice(0, max);
    const already = scored.filter(s => s.list.repoIncluded).map(s => s.list.name);

    let newLists = [];
    if (canCreate && (existing.length === 0 || existing[0].score < 0.55)) {
      const taken = new Set(scored.map(s => s.list.name.toLowerCase()));
      const covered = new Set(scored.map(s => s.category).filter(Boolean));
      const picks = [];
      const push = (name, reason, weak) => {
        if (!name || taken.has(name.toLowerCase())) return;
        taken.add(name.toLowerCase());
        picks.push({ name: name.slice(0, 32), reason, weak: !!weak });
      };

      const cats = [...repoCategories(repo).entries()].sort((a, b) => b[1].weight - a[1].weight);
      const style = namingStyle(scored.map(s => s.list.name), opts.nameLang);
      // 中文模式下拿不到现成中文类别时，用「X 相关」兜住，而不是吐英文
      const localize = name => (style.lang === 'zh' && name && !/[一-龥]/.test(name) ? name + ' 相关' : name);
      for (const [cat, ev] of cats) {
        if (covered.has(cat)) continue;
        push(categoryName(cat, style), '命中内置类别「' + cat + '」（' + ev.hits.slice(0, 3).join('、') + '）');
        if (picks.length >= 2) break;
      }

      if (!picks.length) {
        const topics = (repo.topics || []).filter(t => t && !GENERIC_TOPICS.has(t.toLowerCase()));
        topics.sort((a, b) => (b.includes('-') ? 1 : 0) - (a.includes('-') ? 1 : 0));
        for (const t of topics) {
          const owner = CAT_BY_TOPIC.get(String(t).toLowerCase());
          if (owner) {
            if (covered.has(owner)) continue;
            push(categoryName(owner, style), '由 topic “' + t + '” 归入类别「' + owner + '」');
          } else {
            push(localize(humanize(t)), '由 topic “' + t + '” 归纳');
          }
          if (picks.length >= 2) break;
        }
      }

      if (!picks.length) {
        const nouns = properNouns(repo.description, repo.name);
        if (nouns.length >= 2) push(localize(nouns.slice(0, 2).join(' ')), '由描述中的关键词 “' + nouns.slice(0, 2).join('、') + '” 归纳');
        else if (nouns.length === 1) push(localize(nouns[0]), '由描述中的关键词 “' + nouns[0] + '” 归纳');
      }
      if (!picks.length && repo.language) push(localize(humanize(repo.language) + ' 相关'), '没有 topic 也没有可用关键词，按语言归纳', true);
      if (!picks.length) push(localize(humanize(repo.owner || '')), '信息太少，先按作者归档', true);

      const descSrc = [repo.description, (repo.topics || []).slice(0, 3).join('、')].filter(Boolean).join(' · ');
      newLists = picks.map(p => ({ ...p, description: (descSrc || p.name).slice(0, 160) }));
    }

    return { existing, newLists, already, summary: '', source: 'rule' };
  }

  function buildLlmPrompt(repo, lists, ruleResult, langOverride) {
    const repoCats = [...repoCategories(repo).entries()].sort((a, b) => b[1].weight - a[1].weight);
    const catHint = repoCats.length ? repoCats.map(([c, e]) => c + '(' + e.hits.slice(0, 3).join('/') + ')').join('、') : '无';
    const listLines = lists.map(l => {
      const sample = (l.sampleRepos || []).slice(0, 12).join(', ');
      const cat = listCategory(l);
      return '- id=' + l.id + ' 名称="' + l.name + '" 描述="' + (l.description || '') + '"' + (cat ? ' 规则判定类别=' + cat : '') +
        (l.repoIncluded ? ' [此仓库已在其中]' : '') + (sample ? ' 已含仓库: ' + sample : '');
    }).join('\n');
    const topRules = (ruleResult.existing || []).map(s => s.list.name + '(' + s.score.toFixed(2) + ')').join(', ') || '无';
    const style = namingStyle(lists.map(l => l.name), langOverride);
    const styleHint = (style.lang === 'zh' ? '中文列表名' : '英文列表名') + '，多词用"' + style.sep + '"连接';
    return [
      {
        role: 'system',
        content: '你在帮人把刚 star 的 GitHub 仓库归类到他自己的 Lists（星标收藏夹）。只输出 JSON，不要解释。'
      },
      {
        role: 'user',
        content:
          '仓库：' + repo.slug + '\n' +
          '描述：' + (repo.description || '(无)') + '\n' +
          'topics：' + (repo.topics || []).join(', ') + '\n' +
          '主要语言：' + (repo.language || '(未知)') + '\n' +
          '内置规则判定的类别：' + catHint + '\n' +
          '我的列表命名风格：' + styleHint + '\n' +
          'README 摘要：' + String(repo.readme || '').replace(/\s+/g, ' ').slice(0, 900) + '\n\n' +
          '我现有的 Lists：\n' + (listLines || '(一个都还没有)') + '\n\n' +
          '规则打分参考：' + topRules + '\n\n' +
          '请判断这个项目是做什么的，然后输出：\n' +
          '{"summary":"一句话说明这个项目是做什么的",' +
          '"existing":[{"id":数字,"confidence":0到1,"reason":"中文一句话依据"}],' +
          '"new_lists":[{"name":"不超过32字符","description":"不超过160字符","reason":"中文一句话依据"}]}\n' +
          '要求：existing 只能包含 [此仓库已在其中] 之外的列表；确实没有合适归属时 existing 给空数组并给 1-2 个 new_lists；' +
          'new_lists 的名字要可复用（能容纳同类项目），不要直接用仓库名，也不要和现有列表重名或近义；' +
          '名字必须符合上面给的命名风格（语言和分隔符都要一致），也不要和「规则判定类别」重复。'
      }
    ];
  }

  function parseLlmJson(text) {
    if (!text) return null;
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start < 0 || end <= start) return null;
    try { return JSON.parse(text.slice(start, end + 1)); } catch (e) { return null; }
  }

  // 把 LLM 结果和规则结果合成最终建议，LLM 优先、规则兜底
  function mergeSuggestion(ruleResult, llmRaw, lists, opts) {
    const parsed = parseLlmJson(llmRaw);
    if (!parsed) return { ...ruleResult, llmError: llmRaw ? 'llm output not json' : 'llm empty' };
    const byId = new Map(lists.map(l => [l.id, l]));
    const existing = (parsed.existing || [])
      .map(e => {
        const list = byId.get(Number(e.id));
        if (!list || list.repoIncluded) return null;
        const conf = Math.max(0, Math.min(1, Number(e.confidence) || 0));
        if (conf < (opts.llminConfidence ?? 0.35)) return null;
        return { list, score: conf, reasons: [String(e.reason || '模型判断')], fromLlm: true };
      })
      .filter(Boolean)
      .sort((a, b) => b.score - a.score)
      .slice(0, opts.maxSuggestions);

    const nameTaken = new Set(lists.map(l => l.name.toLowerCase()));
    const newLists = (parsed.new_lists || [])
      .map(n => {
        const name = String(n.name || '').trim().slice(0, 32);
        if (!name || nameTaken.has(name.toLowerCase())) return null;
        nameTaken.add(name.toLowerCase());
        return { name, description: String(n.description || '').trim().slice(0, 160), reason: String(n.reason || '模型建议') };
      })
      .filter(Boolean)
      .slice(0, 2);

    return {
      existing,
      newLists: newLists.length ? newLists : ruleResult.newLists,
      already: ruleResult.already,
      summary: String(parsed.summary || ''),
      source: 'llm',
      llmError: null
    };
  }
  // LOGIC-END

  const VERSION = '0.10.3';
  const CFG_KEY = 'gsa.cfg.v1';
  const VOCAB_KEY = 'gsa.vocab.v2';
  const LLM_CACHE_KEY = 'gsa.llmcache.v1';
  const QUEUE_KEY = 'gsa.queue.v1';
  const VOCAB_MAX = 15;
  // 端点与模型名逐个查证过（2026-10），选预设只负责填好可编辑的默认值
  const PRESETS = {
    'DeepSeek': { url: 'https://api.deepseek.com/v1', model: 'deepseek-flash', hint: '也可填 deepseek-v4-pro' },
    'Kimi（月之暗面）': { url: 'https://api.moonshot.cn/v1', model: 'kimi-k2.6', hint: '也可填 kimi-k3 / moonshot-v1-8k' },
    '智谱 GLM（国内）': { url: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-5.3', hint: '' },
    '智谱 GLM（Z.AI 国际）': { url: 'https://api.z.ai/api/paas/v4', model: 'glm-5.3', hint: '' },
    '通义千问（阿里云百炼）': { url: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-max', hint: '也可填 qwen-plus' },
    '腾讯混元': { url: 'https://api.hunyuan.cloud.tencent.com/v1', model: '', hint: '模型名见混元控制台' },
    'OpenAI': { url: 'https://api.openai.com/v1', model: 'gpt-4o', hint: '' },
    'OpenRouter': { url: 'https://openrouter.ai/api/v1', model: '', hint: '模型形如 provider/model，免费模型带 :free 后缀' },
    '硅基流动 SiliconFlow': { url: 'https://api.siliconflow.cn/v1', model: '', hint: '模型 ID 含组织名，如 deepseek-ai/DeepSeek-V3' },
    '火山方舟（豆包）': { url: 'https://ark.cn-beijing.volces.com/api/v3', model: '', hint: '模型 ID 或自建接入点 ep-xxx 以控制台为准' },
    'Groq': { url: 'https://api.groq.com/openai/v1', model: 'llama-3.3-70b-versatile', hint: '必须带 /openai/v1，否则 404' },
    'Ollama（本地）': { url: 'http://localhost:11434/v1', model: '', hint: '先 ollama pull，再填模型名' },
    'LM Studio（本地）': { url: 'http://localhost:1234/v1', model: '', hint: '需在 LM Studio 里启动本地服务' },
    '自定义 / 其它兼容端点': { url: '', model: '', hint: '' }
  };
  const DEFAULT_CFG = {
    enabled: true,
    showButton: true,
    threshold: 0.3,
    maxSuggestions: 3,
    deepMatch: true,
    onlyWhenNoMatch: false,
    nameLang: 'auto',
    batchLimit: 30,
    llmEnabled: false,
    llmPreset: '自定义 / 其它兼容端点',
    llmBaseUrl: '',
    llmApiKey: '',
    llmModel: '',
    llmTimeout: 30,
    llmTemperature: 0.2,
    llmMaxTokens: 900,
    llmCacheHours: 24,
    vocabTtlHours: 24
  };

  const state = { repo: null, lists: null, result: null, lastError: null, driving: false, panel: null, vocab: null, progress: null, progressSlug: '', ticker: null, dismissed: false, vocabNote: null, runId: 0, llmFromCache: false, anchor: null };

  const q = sel => document.querySelector(sel);
  const qa = sel => [...document.querySelectorAll(sel)];
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const clean = s => String(s || '').replace(/\s+/g, ' ').trim();

  function getCfg() {
    if (!state.cfg) state.cfg = { ...DEFAULT_CFG, ...(GM_getValue(CFG_KEY, {}) || {}) };
    return state.cfg;
  }
  function saveCfg(patch) {
    state.cfg = { ...getCfg(), ...patch };
    GM_setValue(CFG_KEY, state.cfg);
    return state.cfg;
  }

  function waitUntil(getter, timeout = 4000, step = 120) {
    return new Promise((resolve, reject) => {
      const t0 = Date.now();
      const tick = () => {
        let val;
        try { val = getter(); } catch (e) { val = null; }
        if (val) return resolve(val);
        if (Date.now() - t0 > timeout) return reject(new Error('timeout waiting for element'));
        setTimeout(tick, step);
      };
      tick();
    });
  }

  function repoSlugFromUrl() {
    const seg = location.pathname.split('/').filter(Boolean);
    if (seg.length < 2) return null;
    const reserved = new Set(['orgs', 'settings', 'topics', 'search', 'login', 'signup', 'notifications', 'stars', 'collections', 'marketplace', 'features', 'new', 'issues', 'pulls', 'discussions']);
    if (reserved.has(seg[0])) return null;
    return { owner: seg[0], name: seg[1], slug: seg[0] + '/' + seg[1] };
  }

  function starButton() {
    return q('[data-testid="star-button"]');
  }
  function isRepoHeaderPage() {
    return !!q('[data-testid="repo-name-link"]') && !!starButton();
  }
  function isStarred() {
    const b = starButton();
    if (!b) return false;
    const aria = (b.getAttribute('aria-label') || '').toLowerCase();
    if (aria.startsWith('unstar')) return true;
    if (aria.startsWith('star ')) return false;
    return /starred/.test(b.textContent || '');
  }

  function readRepo() {
    const ids = repoSlugFromUrl();
    if (!ids) return null;
    const descSrc = (q('meta[name="description"]') || {}).content || (q('meta[property="og:description"]') || {}).content || '';
    const esc = ids.slug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const description = descSrc
      .replace(new RegExp('\\.?\\s*Contribute to ' + esc + ' development by creating an account on GitHub\\.?\\s*$'), '')
      .replace(new RegExp('\\s*[-|·]\\s*' + esc + '\\s*$'), '')
      .replace(/\s*[-|·]\s*GitHub\s*$/i, '')
      .trim();
    const topics = [...new Set(
      qa('a').filter(a => (a.getAttribute('href') || '').startsWith('/topics/')).map(a => clean(a.textContent))
    )].filter(Boolean);
    const langSpans = qa('span[itemprop="programmingLanguage"]');
    const language = langSpans.length ? clean(langSpans[0].textContent) : clean((q('.progress-Counter') || {}).textContent || '').split('%')[0].trim();
    const readme = (q('article') || {}).innerText || '';
    return { ...ids, description, topics, language, readme };
  }

  async function fetchLists() {
    const r = state.repo;
    const res = await fetch('/' + r.slug + '/_header/lists?reloadAt=' + Date.now(), {
      credentials: 'same-origin',
      headers: { 'x-requested-with': 'XMLHttpRequest', accept: 'application/json' }
    });
    if (!res.ok) throw new Error('lists 接口 ' + res.status);
    const data = await res.json();
    if (!data || !Array.isArray(data.lists)) throw new Error('lists 接口返回结构变了');
    return data;
  }

  function loadVocabCache() {
    if (!state.vocab) state.vocab = GM_getValue(VOCAB_KEY, {}) || {};
    return state.vocab;
  }
  function saveVocabCache() {
    GM_setValue(VOCAB_KEY, state.vocab);
  }

  function applyCorpus(list, repos) {
    list.sampleRepos = repos.slice(0, 12).map(r => r.n);
    list.vocabTokens = tokenize(repos.map(r => r.n + ' ' + (r.d || '') + ' ' + (r.l || '')).join(' '));
    list.learned = [...categoriesFromText(repos.map(r => r.n + ' ' + (r.d || '')).join(' ')).keys()];
  }

  // 深匹配：抓 profile 的 stars 页拿 slug，再抓每个列表页拿「列表里已有哪些仓库」
  async function loadVocab(lists, onEach) {
    const cfg = getCfg();
    const login = (q('meta[name="user-login"]') || {}).content;
    if (!login) return;
    const cache = loadVocabCache();
    const now = Date.now();
    const ttl = cfg.vocabTtlHours * 3600 * 1000;
    const nameToSlug = {};
    try {
      const html = await (await fetch('/' + login + '?tab=stars', { credentials: 'same-origin' })).text();
      const doc = new DOMParser().parseFromString(html, 'text/html');
      doc.querySelectorAll('#profile-lists-container a[href*="/lists/"]').forEach(a => {
        const href = a.getAttribute('href') || '';
        const m = href.match(/\/stars\/[^/]+\/lists\/([^/?#]+)/);
        const name = clean((a.querySelector('h3') || {}).textContent || a.textContent);
        if (m && name) nameToSlug[name.toLowerCase()] = m[1];
      });
    } catch (e) { return; }

    const target = lists.slice(0, VOCAB_MAX).map(list => ({ list, slug: nameToSlug[list.name.toLowerCase()] }));
    let done = 0;
    const step = () => { done++; if (onEach) onEach(done, target.length); };
    const queue = target.slice();
    const worker = async () => {
      while (queue.length) {
        const { list, slug } = queue.shift();
        if (slug) {
          const key = login + '/' + slug;
          if (cache[key] && now - cache[key].at < ttl) applyCorpus(list, cache[key].repos);
          else {
            try {
              const html = await (await fetch('/stars/' + login + '/lists/' + slug, { credentials: 'same-origin' })).text();
              const doc = new DOMParser().parseFromString(html, 'text/html');
              const seen = new Set();
              const repos = [...doc.querySelectorAll('#user-list-repositories .col-12')].map(r => ({
                n: clean((r.querySelector('h2 a') || {}).textContent),
                d: clean((r.querySelector('[itemprop="description"]') || {}).textContent),
                l: clean((r.querySelector('[itemprop="programmingLanguage"]') || {}).textContent)
              })).filter(r => r.n && !seen.has(r.n) && seen.add(r.n));
              cache[key] = { at: now, repos };
              saveVocabCache();
              applyCorpus(list, repos);
            } catch (e) { /* 单个列表抓不到不影响整体 */ }
          }
        }
        step();
      }
    };
    await Promise.all(Array.from({ length: Math.min(4, target.length) }, worker));
  }

  function httpPost(url, headers, body, timeout) {
    if (typeof GM_xmlhttpRequest === 'function') {
      return new Promise((resolve, reject) => {
        GM_xmlhttpRequest({
          method: 'POST', url, headers, data: body, timeout,
          onload: r => r.status < 400 ? resolve(r.responseText) : reject(Object.assign(new Error('HTTP ' + r.status + ' ' + String(r.responseText || '').slice(0, 180)), { status: r.status, text: r.responseText })),
          onerror: () => reject(new Error('LLM 请求失败（网络或被拦）')),
          ontimeout: () => reject(new Error('LLM 请求超时'))
        });
      });
    }
    return fetch(url, { method: 'POST', headers, body, signal: AbortSignal.timeout(timeout) }).then(async r => {
      const text = await r.text();
      if (!r.ok) throw Object.assign(new Error('HTTP ' + r.status + ' ' + String(text).slice(0, 180)), { status: r.status, text });
      return text;
    });
  }

  function httpGet(url, headers, timeout) {
    if (typeof GM_xmlhttpRequest === 'function') {
      return new Promise((resolve, reject) => {
        GM_xmlhttpRequest({
          method: 'GET', url, headers, timeout,
          onload: r => r.status < 400 ? resolve(r.responseText) : reject(Object.assign(new Error('HTTP ' + r.status + ' ' + String(r.responseText || '').slice(0, 160)), { status: r.status })),
          onerror: () => reject(new Error('请求失败（网络或被拦）')),
          ontimeout: () => reject(new Error('请求超时'))
        });
      });
    }
    return fetch(url, { headers, signal: AbortSignal.timeout(timeout) }).then(async r => {
      const text = await r.text();
      if (!r.ok) throw Object.assign(new Error('HTTP ' + r.status + ' ' + String(text).slice(0, 160)), { status: r.status });
      return text;
    });
  }

  function llmModels() {
    const cfg = getCfg();
    const base = (cfg.llmBaseUrl || '').trim().replace(/\/+$/, '').replace(/\/chat\/completions$/, '');
    if (!base) return Promise.reject(new Error('还没填 Base URL'));
    return httpGet(base + '/models', { authorization: 'Bearer ' + cfg.llmApiKey, accept: 'application/json' }, 20000).then(t => {
      const j = JSON.parse(t);
      const arr = j.data || j.models || [];
      return arr.map(m => (m && (m.id || m.name)) || (typeof m === 'string' ? m : '')).filter(Boolean);
    });
  }

  function llmChat(messages) {
    const cfg = getCfg();
    const base = (cfg.llmBaseUrl || '').trim().replace(/\/+$/, '');
    if (!base || !cfg.llmApiKey || !cfg.llmModel) return Promise.reject(new Error('LLM 未配置完整'));
    const url = /\/chat\/completions$/.test(base) ? base : base + '/chat/completions';
    const headers = { 'content-type': 'application/json', authorization: 'Bearer ' + cfg.llmApiKey };
    const request = withFormat => {
      const body = {
        model: cfg.llmModel,
        messages,
        temperature: Number(cfg.llmTemperature),
        max_tokens: Number(cfg.llmMaxTokens),
        stream: false
      };
      if (withFormat) body.response_format = { type: 'json_object' };
      return httpPost(url, headers, JSON.stringify(body), Math.max(5, Number(cfg.llmTimeout)) * 1000);
    };
    const content = text => {
      const j = JSON.parse(text);
      return ((j.choices || [])[0] || {}).message?.content || '';
    };
    return request(true)
      .then(content)
      .catch(err => {
        const shapeIssue = err instanceof SyntaxError || (err.status >= 400 && err.status < 500 && /response_format|json/i.test(err.text || ''));
        if (!shapeIssue) throw err;
        return request(false).then(content);
      });
  }

  // 同一仓库 + 同一列表状态下 24 小时内不重复花 token
  function llmCacheKey() {
    const cfg = getCfg();
    const sig = (state.lists || []).map(l => l.id + (l.repoIncluded ? '*' : '')).join(',');
    return ((state.repo || {}).slug || '') + '|' + cfg.llmModel + '|' + sig;
  }
  function llmCacheGet() {
    const cfg = getCfg();
    const cache = GM_getValue(LLM_CACHE_KEY, {}) || {};
    const hit = cache[llmCacheKey()];
    if (!hit || Date.now() - hit.at > cfg.llmCacheHours * 3600 * 1000) return null;
    return hit.raw;
  }
  function llmCacheSet(raw) {
    const cache = GM_getValue(LLM_CACHE_KEY, {}) || {};
    const now = Date.now();
    for (const k of Object.keys(cache)) if (!cache[k] || now - cache[k].at > 30 * 864e5) delete cache[k];
    cache[llmCacheKey()] = { at: now, raw };
    GM_setValue(LLM_CACHE_KEY, cache);
  }

  // 阶段 A：同源取数 + 词面打分。不弹面板，所以「只在没匹配时弹出」不会先闪再消失
  async function analyzeFast() {
    state.lastError = null;
    try {
      state.repo = readRepo();
      if (!state.repo) throw new Error('没识别出仓库');
      const data = await fetchLists();
      state.listsData = data;
      state.lists = data.lists.map(l => ({ ...l, vocabTokens: null, sampleRepos: [], learned: [] }));
      return scoreLists(state.repo, state.lists);
    } catch (e) {
      state.lastError = e.message;
      state.result = null;
      return null;
    }
  }

  function hasRealMatch(scored, cfg) {
    return (scored || []).some(s => !s.list.repoIncluded && !s.catchAll && s.score >= cfg.threshold);
  }

  // 阶段 B：深匹配 + 规则 + 模型，全程带进度。mine 是本轮令牌，过期轮次静默退出
  async function analyzeDeep(scored, mine) {
    const st = (k, s, d) => { if (mine === state.runId) setStage(k, s, d); };
    try {
      const cfg = getCfg();
      st('read', 'done', state.repo.topics.length + ' topics');
      st('lists', 'done', state.lists.length + ' 个列表');

      const total = Math.min(state.lists.length, VOCAB_MAX);
      const unread = state.lists.length - total;
      state.vocabNote = null;
      if (!cfg.deepMatch) st('vocab', 'skip', '已关闭');
      else if (!state.lists.length) st('vocab', 'skip', '还没有列表');
      else if (hasRealMatch(scored, cfg)) st('vocab', 'skip', '列表名已够匹配');
      else {
        st('vocab', 'run', '0/' + total);
        await loadVocab(state.lists, done => st('vocab', 'run', done + '/' + total));
        if (mine !== state.runId) return null;
        scored = scoreLists(state.repo, state.lists);
        st('vocab', 'done', total + ' 个已读');
        // 阶段文案只活一帧就被顶掉，截断这件事要写在最终面板上才看得见
        if (unread > 0) state.vocabNote = '辅助匹配只读了前 ' + total + ' 个列表，另有 ' + unread + ' 个未参与匹配';
      }
      state.scored = scored;

      st('rank', 'run');
      let result = ruleSuggest(state.repo, scored, { threshold: cfg.threshold, maxSuggestions: cfg.maxSuggestions, canCreateList: state.listsData.canCreateList, nameLang: cfg.nameLang });
      st('rank', 'done', result.existing.length + ' 个可归入');

      if (!cfg.llmEnabled || !cfg.llmBaseUrl || !cfg.llmApiKey) st('llm', 'skip', '未启用');
      else {
        st('llm', 'run', cfg.llmModel || '模型');
        try {
          const opts = { maxSuggestions: cfg.maxSuggestions, llminConfidence: 0.35 };
          const cached = llmCacheGet();
          let raw = cached;
          state.llmFromCache = !!cached;
          if (!raw) {
            raw = await llmChat(buildLlmPrompt(state.repo, state.lists, result, cfg.nameLang));
            if (!parseLlmJson(raw)) {
              if (mine !== state.runId) return null;
              st('llm', 'run', '输出非 JSON，追问重试');
              const msgs = buildLlmPrompt(state.repo, state.lists, result, cfg.nameLang);
              msgs.push({ role: 'assistant', content: String(raw).slice(0, 500) });
              msgs.push({ role: 'user', content: '上一条无法解析为 JSON。只输出一个 JSON 对象，不要解释、不要代码块围栏。' });
              raw = await llmChat(msgs);
            }
            if (mine !== state.runId) return null;
            if (parseLlmJson(raw)) llmCacheSet(raw);
          }
          result = mergeSuggestion(result, raw, state.lists, opts);
          st('llm', 'done', result.source === 'llm' ? (state.llmFromCache ? '已采纳（缓存）' : '已采纳') : '输出不可用');
        } catch (e) {
          state.lastError = 'LLM：' + e.message;
          st('llm', 'fail', '已退回规则结果');
        }
      }
      state.result = result;
      return result;
    } catch (e) {
      state.lastError = e.message;
      state.result = null;
      return null;
    }
  }

  /* ------------------------------ 驱动原生面板 ------------------------------ */

  function fireFull(el) {
    const opts = { bubbles: true, cancelable: true, composed: true };
    ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach(type => {
      el.dispatchEvent(new(type.startsWith('pointer') ? PointerEvent : MouseEvent)(type, { ...opts, pointerId: 1, button: 0, isPrimary: true }));
    });
  }

  async function openNativePanel() {
    const btn = q('[data-testid="star-dropdown-button"]');
    if (!btn) throw new Error('找不到 star 下拉按钮（GitHub 结构可能变了）');
    if (!q('[role="dialog"] li[data-id]')) {
      state.driving = true;
      btn.click();
      try { await waitUntil(() => q('[role="dialog"] li[data-id]'), 4000); }
      catch (e) { state.driving = false; throw new Error('原生 Lists 面板没打开'); }
    }
  }

  function closeNativePanel() {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    setTimeout(() => { state.driving = false; }, 400);
  }

  async function setOption(listId, want) {
    const sel = 'li[data-id="list-' + listId + '"]';
    await waitUntil(() => q(sel), 3000);
    const li = q(sel);
    const now = li.getAttribute('aria-selected') === 'true';
    if (now !== want) { fireFull(li); await sleep(250); }
    return li.getAttribute('aria-selected') === 'true';
  }

  async function addToList(listId) {
    await openNativePanel();
    const ok = await setOption(listId, true);
    closeNativePanel();
    if (!ok) throw new Error('勾选没生效');
    return verifyMembership(listId);
  }

  async function setReactValue(el, value) {
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
    el.focus();
    setter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  async function createListAndAdd(name, description) {
    await openNativePanel();
    const dialog = q('[role="dialog"]');
    const createBtn = [...dialog.querySelectorAll('button')].find(b => /create list/i.test(clean(b.textContent)));
    if (!createBtn) throw new Error('找不到 Create list 按钮');
    createBtn.click();
    const form = await waitUntil(() => qa('[role="dialog"][aria-modal="true"]').find(d => d.querySelectorAll('input,textarea').length >= 1), 4000);
    const textFields = [...form.querySelectorAll('input:not([type=checkbox]):not([type=radio]), textarea')];
    if (!textFields.length) throw new Error('创建弹窗里找不到输入框');
    await setReactValue(textFields[0], name);
    if (textFields[1] && description) await setReactValue(textFields[1], description);
    const formButtons = [...form.querySelectorAll('button')].filter(b => !/close/i.test(b.getAttribute('aria-label') || ''));
    const submit = formButtons.find(b => /^create$/i.test(clean(b.textContent))) || formButtons[formButtons.length - 1];
    if (!submit) throw new Error('找不到提交按钮');
    submit.click();
    closeNativePanel();
    const data = await waitForNewList(name);
    if (!data) throw new Error('列表没建出来');
    const created = data.lists.find(l => l.name.toLowerCase() === name.toLowerCase());
    if (!created) throw new Error('找不到新建的列表');
    if (!created.repoIncluded) {
      // 建列表未必会把当前仓库放进去，用已验通的「勾选 + 关面板」补上
      await openNativePanel();
      await setOption(created.id, true);
      closeNativePanel();
      return verifyMembership(created.id, name);
    }
    return { ok: true, list: created };
  }

  async function waitForNewList(name) {
    for (let i = 0; i < 12; i++) {
      await sleep(500);
      try {
        const data = await fetchLists();
        state.listsData = data;
        if (data.lists.some(l => l.name.toLowerCase() === name.toLowerCase())) return data;
      } catch (e) { /* 重试 */ }
    }
    return null;
  }

  async function verifyMembership(listId, name) {
    for (let i = 0; i < 12; i++) {
      await sleep(400);
      try {
        const data = await fetchLists();
        state.listsData = data;
        const hit = data.lists.find(l => l.id === Number(listId)) || data.lists.find(l => name && l.name.toLowerCase() === name.toLowerCase());
        if (hit && hit.repoIncluded) return { ok: true, list: hit };
        if (i > 6 && hit) return { ok: false, list: hit };
      } catch (e) { /* 重试 */ }
    }
    return { ok: false };
  }

  /* --------------------------------- UI --------------------------------- */

  const CSS = `
  .gsa-panel{position:fixed;z-index:99999;width:392px;max-width:calc(100vw - 24px);max-height:76vh;overflow:auto;border-radius:8px;
    border:1px solid var(--borderColor-default,#d0d7de);background:var(--bgColor-default,#fff);
    color:var(--fgColor-default,#1f2328);box-shadow:0 8px 24px rgba(31,35,40,.18);font-size:12px;
    font-family:system-ui,-apple-system,"Segoe UI",Helvetica,Arial,sans-serif;padding:10px 12px}
  .gsa-panel *{box-sizing:border-box}
  .gsa-h{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:6px}
  .gsa-title{font-weight:600;font-size:13px}
  .gsa-badge{font-size:11px;padding:1px 6px;border-radius:10px;border:1px solid var(--borderColor-default,#d0d7de);color:var(--fgColor-muted,#656d76)}
  .gsa-badge.llm{border-color:var(--fgColor-success,#1a7f37);color:var(--fgColor-success,#1a7f37)}
  .gsa-summary{color:var(--fgColor-muted,#656d76);margin:2px 0 8px;line-height:1.5}
  .gsa-sec{font-weight:600;margin:8px 0 4px;color:var(--fgColor-muted,#57606a)}
  .gsa-row{display:flex;align-items:flex-start;gap:8px;padding:6px;border-radius:6px;border:1px solid transparent}
  .gsa-row:hover{background:rgba(128,128,128,.1)}
  .gsa-rowmain{flex:1;min-width:0}
  .gsa-name{font-weight:600}
  .gsa-reason{color:var(--fgColor-muted,#656d76);line-height:1.45;margin-top:2px}
  .gsa-score{font-variant-numeric:tabular-nums;color:var(--fgColor-muted,#656d76);font-size:11px}
  .gsa-btn{border:1px solid var(--borderColor-default,#d1d9e0);background:transparent;
    color:inherit;border-radius:6px;padding:3px 9px;cursor:pointer;font-size:12px;white-space:nowrap}
  .gsa-btn:hover{background:rgba(128,128,128,.16)}
  .gsa-btn.primary{background:var(--bgColor-success-emphasis,#1f883d);border-color:transparent;color:#fff}
  .gsa-btn.primary:hover{filter:brightness(.92)}
  .gsa-btn:disabled{opacity:.5;cursor:default}
  .gsa-x{cursor:pointer;color:var(--fgColor-muted,#656d76);border:0;background:none;font-size:15px;line-height:1;padding:2px 4px}
  .gsa-foot{display:flex;gap:10px;align-items:center;margin-top:8px;padding-top:8px;border-top:1px solid var(--borderColor-muted,#d0d7de)}
  .gsa-link{color:var(--fgColor-accent,#0969da);cursor:pointer;background:none;border:0;font-size:12px;padding:0}
  .gsa-ok{color:var(--fgColor-success,#1a7f37)}
  .gsa-warn{color:var(--fgColor-attention,#9a6700)}
  .gsa-settings{margin-top:8px;display:grid;grid-template-columns:1fr 1fr;gap:6px}
  .gsa-settings label{font-size:11px;color:var(--fgColor-muted,#656d76);display:flex;flex-direction:column;gap:2px}
  .gsa-settings input,.gsa-settings select{font-size:12px;padding:3px 6px;border-radius:6px;border:1px solid var(--borderColor-default,#d1d9e0);background:transparent;color:inherit;width:100%}
  .gsa-settings .wide{grid-column:1 / -1}
  .gsa-check{flex-direction:row!important;align-items:center;gap:6px!important}
  .gsa-bar{height:3px;border-radius:2px;background:rgba(128,128,128,.28);overflow:hidden;margin:2px 0 8px}
  .gsa-barfill{height:100%;width:0;background:var(--bgColor-success-emphasis,#1f883d);transition:width .25s ease}
  .gsa-stages{display:flex;flex-direction:column;gap:3px;margin:2px 0 4px}
  .gsa-stage{display:flex;align-items:center;gap:7px;color:var(--fgColor-muted,#656d76);line-height:1.6}
  .gsa-stage i{width:6px;height:6px;border-radius:50%;background:var(--borderColor-default,#d0d7de);flex:none}
  .gsa-stage.run{color:var(--fgColor-default,#1f2328)}
  .gsa-stage.run i{background:var(--fgColor-accent,#0969da);animation:gsa-pulse 1s ease-in-out infinite}
  .gsa-stage.done i{background:var(--fgColor-success,#1a7f37)}
  .gsa-stage.fail i{background:var(--fgColor-attention,#9a6700)}
  .gsa-stage.skip i{background:transparent;border:1px solid var(--borderColor-default,#d0d7de)}
  .gsa-stage b{font-weight:400;margin-left:auto;font-variant-numeric:tabular-nums;font-size:11px;color:var(--fgColor-muted,#656d76)}
  .gsa-btnrow{display:flex;gap:6px;flex-wrap:wrap}
  .gsa-err{margin-top:6px;line-height:1.5}
  .gsa-batch{width:600px;max-height:80vh;display:flex;flex-direction:column;overflow:hidden}
  .gsa-batch-body{flex:1 1 auto;min-height:0;overflow:auto;margin:0 -12px;padding:0 12px}
  .gsa-batch .gsa-row{align-items:center}
  .gsa-batch input[type=checkbox]{margin:2px 6px 0 0;flex:none}
  .gsa-open{display:inline-flex;align-items:center;gap:4px;height:28px;padding:0 10px;border-radius:6px;cursor:pointer;
    font-size:12px;white-space:nowrap;color:inherit;
    border:1px solid var(--borderColor-default,#d1d9e0);background:transparent}
  .gsa-open:hover{background:rgba(128,128,128,.16)}
  .gsa-open i{font-style:normal}
  @keyframes gsa-pulse{0%,100%{opacity:.3}50%{opacity:1}}
  `;

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function ensureStyle() {
    const cur = q('#gsa-style');
    // 同一文档里可能残留旧版样式（热更新/多实例），版本不一致就覆盖掉
    if (cur) { if (cur.dataset.v !== VERSION) { cur.dataset.v = VERSION; cur.textContent = CSS; } return; }
    const s = document.createElement('style');
    s.id = 'gsa-style';
    s.dataset.v = VERSION;
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  function hidePanel() {
    stopTicker();
    state.renderedFor = null;
    if (state.panel) { state.panel.remove(); state.panel = null; }
  }

  const STAGES = [
    { key: 'read', label: '读取项目信息' },
    { key: 'lists', label: '拉取你的 Lists 清单' },
    { key: 'vocab', label: '读列表已有内容辅助匹配' },
    { key: 'rank', label: '规则打分' },
    { key: 'llm', label: '模型判断（精修）' }
  ];

  function startTicker() {
    stopTicker();
    state.ticker = setInterval(renderProgress, 1000);
  }
  function stopTicker() {
    if (state.ticker) { clearInterval(state.ticker); state.ticker = null; }
  }

  function startProgress(slug) {
    state.progress = STAGES.map(s => ({ ...s, status: 'wait', detail: '', t0: 0 }));
    state.progressSlug = slug;
    renderProgress();
    startTicker();
  }

  function setStage(key, status, detail) {
    if (!state.progress) return;
    const st = state.progress.find(s => s.key === key);
    if (!st) return;
    if (status === 'run' && st.status !== 'run') st.t0 = Date.now();
    st.status = status;
    if (detail !== undefined) st.detail = detail;
    renderProgress();
  }

  function closeButton(onClick) {
    const x = el('button', 'gsa-x', '×');
    x.type = 'button';
    x.title = '关闭';
    x.addEventListener('click', onClick || cancelRun);
    return x;
  }

  function renderProgress() {
    if (!state.progress) return;
    ensureStyle();
    if (!state.panel || !state.panel.classList.contains('gsa-progress')) {
      stopTicker();
      if (state.panel) state.panel.remove();
      state.panel = el('div', 'gsa-panel gsa-progress');
      document.body.appendChild(state.panel);
      state.renderedFor = state.progressSlug;
    }
    const p = state.panel;
    p.replaceChildren();

    const head = el('div', 'gsa-h');
    head.appendChild(el('span', 'gsa-title', '分析 ' + state.progressSlug));
    head.appendChild(closeButton());
    p.appendChild(head);

    const fill = el('div', 'gsa-barfill');
    const bar = el('div', 'gsa-bar');
    bar.appendChild(fill);
    p.appendChild(bar);

    const box = el('div', 'gsa-stages');
    for (const s of state.progress) {
      const row = el('div', 'gsa-stage ' + s.status);
      row.appendChild(el('i'));
      row.appendChild(el('span', '', s.label));
      const bits = [s.detail];
      if (s.status === 'run' && s.t0) bits.push(((Date.now() - s.t0) / 1000).toFixed(0) + 's');
      const txt = bits.filter(Boolean).join(' · ');
      if (txt) row.appendChild(el('b', '', txt));
      box.appendChild(row);
    }
    p.appendChild(box);

    const settled = state.progress.filter(s => s.status === 'done' || s.status === 'skip' || s.status === 'fail').length;
    fill.style.width = Math.round(settled / state.progress.length * 100) + '%';
    positionPanel();
  }

  function showProgressError() {
    const running = state.progress.find(s => s.status === 'run') || {};
    setStage(running.key || 'rank', 'fail', state.lastError || '分析失败');
    stopTicker();
    const foot = el('div', 'gsa-foot');
    foot.appendChild(buttonRow('重试', '', () => showForRepo(true)));
    foot.appendChild(el('span', 'gsa-err gsa-warn', 'GitHub 结构或网络可能变了；详情见控制台 gsaDiag()'));
    state.panel.appendChild(foot);
    positionPanel();
  }

  function positionPanel() {
    if (!state.panel) return;
    const anchor = state.anchor && state.anchor.isConnected ? state.anchor : starButton();
    if (!anchor) return;
    const r = anchor.getBoundingClientRect();
    const p = state.panel;
    p.style.visibility = 'hidden';
    const h = p.offsetHeight;
    let left = r.right - p.offsetWidth * 0.72;
    left = Math.max(12, Math.min(left, window.innerWidth - p.offsetWidth - 12));
    let top = r.bottom + 8;
    top = Math.min(top, Math.max(12, window.innerHeight - h - 12));
    top = Math.max(12, top);
    p.style.left = left + 'px';
    p.style.top = top + 'px';
    p.style.visibility = 'visible';
  }

  function buttonRow(label, cls, onClick) {
    const b = el('button', 'gsa-btn' + (cls ? ' ' + cls : ''), label);
    b.type = 'button';
    b.addEventListener('click', onClick);
    return b;
  }

  function renderPanel() {
    ensureStyle();
    hidePanel();
    const res = state.result;
    const p = el('div', 'gsa-panel');
    state.panel = p;

    const head = el('div', 'gsa-h');
    head.appendChild(el('span', 'gsa-title', '归类到 List'));
    const badge = el('span', 'gsa-badge' + (res.source === 'llm' ? ' llm' : ''), res.source === 'llm' ? 'LLM 判断' : '规则匹配');
    head.appendChild(badge);
    const x = el('button', 'gsa-x', '×');
    x.type = 'button';
    x.title = '关闭';
    x.addEventListener('click', () => { hidePanel(); if (state.sessionOff) state.sessionOff = false; });
    head.appendChild(x);
    p.appendChild(head);

    if (res.summary) p.appendChild(el('div', 'gsa-summary', res.summary));
    if (res.already.length) p.appendChild(el('div', 'gsa-summary', '此仓库已在：' + res.already.join('、')));
    if (state.vocabNote) p.appendChild(el('div', 'gsa-summary', state.vocabNote));

    if (res.existing.length) {
      p.appendChild(el('div', 'gsa-sec', '推荐加入的 Lists'));
      for (const s of res.existing) {
        const row = el('div', 'gsa-row');
        const main = el('div', 'gsa-rowmain');
        main.appendChild(el('div', 'gsa-name', s.list.name + '  '));
        main.querySelector('.gsa-name').appendChild(el('span', 'gsa-score', Math.round(s.score * 100) + '%'));
        main.appendChild(el('div', 'gsa-reason', s.reasons.slice(0, 2).join('；') || '—'));
        row.appendChild(main);
        const status = el('span', '');
        row.appendChild(buttonRow('加入', '', async () => {
          status.textContent = '处理中…';
          status.className = 'gsa-reason';
          try {
            const v = await addToList(s.list.id);
            status.textContent = v.ok ? '已加入 ✓' : '点了但没生效，请手动勾';
            status.className = v.ok ? 'gsa-ok' : 'gsa-warn';
            if (v.ok) hidePanel();
          } catch (e) {
            status.textContent = '失败：' + e.message;
            status.className = 'gsa-warn';
          }
        }));
        row.appendChild(status);
        p.appendChild(row);
      }
    }

    if (res.newLists.length) {
      p.appendChild(el('div', 'gsa-sec', res.existing.length ? '或新建一个 List' : '没有合适的 List，建议新建'));
      for (const n of res.newLists) {
        const row = el('div', 'gsa-row');
        const main = el('div', 'gsa-rowmain');
        main.appendChild(el('div', 'gsa-name', n.name));
        main.appendChild(el('div', 'gsa-reason', (n.description || '') + (n.reason ? '（' + n.reason + '）' : '')));
        row.appendChild(main);
        const status = el('span', '');
        if (state.listsData && state.listsData.canCreateList === false) {
          row.appendChild(el('span', 'gsa-warn', '当前不能建列表'));
        } else {
          row.appendChild(buttonRow('创建并加入', 'primary', async () => {
            status.textContent = '处理中…';
            status.className = 'gsa-reason';
            try {
              const v = await createListAndAdd(n.name, n.description);
              status.textContent = v.ok ? '已建好并加入 ✓' : '建好了但归属没确认，请手动勾';
              status.className = v.ok ? 'gsa-ok' : 'gsa-warn';
              if (v.ok) hidePanel();
            } catch (e) {
              status.textContent = '失败：' + e.message;
              status.className = 'gsa-warn';
            }
          }));
        }
        row.appendChild(status);
        p.appendChild(row);
      }
    }

    const foot = el('div', 'gsa-foot');
    const toggle = el('button', 'gsa-link', '设置');
    toggle.type = 'button';
    toggle.addEventListener('click', () => {
      const box = p.querySelector('.gsa-settings');
      if (box) box.remove();
      else p.appendChild(buildSettingsForm());
      positionPanel();
    });
    foot.appendChild(toggle);
    const openNative = el('button', 'gsa-link', '打开原生面板');
    openNative.type = 'button';
    openNative.addEventListener('click', () => { openNativePanel().then(() => { state.driving = true; setTimeout(() => { state.driving = false; }, 600); }).catch(e => alert(e.message)); });
    foot.appendChild(openNative);
    const skip = el('button', 'gsa-link', '本次不再弹');
    skip.type = 'button';
    skip.addEventListener('click', () => { state.sessionOff = true; cancelRun(); });
    foot.appendChild(skip);
    if (state.lastError) foot.appendChild(el('span', 'gsa-warn', state.lastError));
    p.appendChild(foot);

    document.body.appendChild(p);
    positionPanel();
    state.renderedFor = state.repo && state.repo.slug;
  }

  function buildSettingsForm() {
    const cfg = getCfg();
    const box = el('div', 'gsa-settings');
    const field = (labelText, input, wide) => {
      const lab = el('label', wide ? 'wide' : '');
      lab.appendChild(el('span', '', labelText));
      lab.appendChild(input);
      box.appendChild(lab);
      return input;
    };
    const num = (key, min, max, step) => {
      const i = document.createElement('input');
      i.type = 'number'; i.min = min; i.max = max; i.step = step; i.value = cfg[key];
      i.addEventListener('change', () => saveCfg({ [key]: Number(i.value) }));
      return i;
    };
    const text = (key, ph) => {
      const i = document.createElement('input');
      i.type = 'text'; i.placeholder = ph || ''; i.value = cfg[key] || '';
      i.addEventListener('change', () => saveCfg({ [key]: i.value.trim() }));
      return i;
    };
    const check = (key, labelText) => {
      const wrap = el('label', 'wide gsa-check');
      const i = document.createElement('input');
      i.type = 'checkbox'; i.checked = !!cfg[key];
      i.style.width = 'auto';
      i.addEventListener('change', () => { saveCfg({ [key]: i.checked }); ensureHeaderButton(); ensureBatchButton(); });
      wrap.appendChild(i);
      wrap.appendChild(el('span', '', labelText));
      box.appendChild(wrap);
      return i;
    };
    const langSel = document.createElement('select');
    [['auto', '自动跟随我现有列表'], ['zh', '强制中文'], ['en', '强制英文']].forEach(pair => {
      const o = document.createElement('option');
      o.value = pair[0];
      o.textContent = pair[1];
      langSel.appendChild(o);
    });
    langSel.value = cfg.nameLang || 'auto';
    langSel.addEventListener('change', () => saveCfg({ nameLang: langSel.value }));
    field('匹配阈值', num('threshold', 0, 1, 0.05));
    field('最多建议数', num('maxSuggestions', 1, 6, 1));
    field('推荐列表名语言', langSel);
    field('批量上限', num('batchLimit', 5, 200, 5));
    field('列表内容缓存小时', num('vocabTtlHours', 1, 720, 1));
    check('showButton', '在仓库头和 stars 页显示按钮（关掉后按 Alt+L 唤出）');
    check('deepMatch', '分数不够时去读列表内容辅助匹配（也用于自学习）');
    check('onlyWhenNoMatch', '只在没有匹配到现有 List 时弹出');
    check('llmEnabled', '启用 LLM 增强（OpenAI 兼容 /chat/completions）');

    const urlInput = text('llmBaseUrl', '选下面的预设会自动填，也可手改');
    const modelInput = text('llmModel', 'deepseek-flash / kimi-k2.6 / glm-5.3 …');
    const modelList = el('datalist');
    modelList.id = 'gsa-models-' + Math.random().toString(36).slice(2, 8);
    modelInput.setAttribute('list', modelList.id);
    const keyInput = text('llmApiKey', 'sk-…');
    keyInput.type = 'password';
    const preset = document.createElement('select');
    Object.keys(PRESETS).forEach(k => { const o = document.createElement('option'); o.value = k; o.textContent = k; preset.appendChild(o); });
    preset.value = cfg.llmPreset && PRESETS[cfg.llmPreset] ? cfg.llmPreset : '自定义 / 其它兼容端点';
    const hint = el('span', 'gsa-reason', (PRESETS[preset.value] || {}).hint || '');
    preset.addEventListener('change', () => {
      const pr = PRESETS[preset.value] || { url: '', model: '' };
      if (!pr.url && !pr.model) return;
      urlInput.value = pr.url;
      modelInput.value = pr.model;
      saveCfg({ llmPreset: preset.value, llmBaseUrl: pr.url, llmModel: pr.model });
      hint.textContent = pr.hint || '';
    });
    const testBtn = buttonRow('测试连接', '', async () => {
      saveCfg({ llmBaseUrl: urlInput.value.trim(), llmModel: modelInput.value.trim(), llmApiKey: keyInput.value.trim() });
      hint.textContent = '测试中…';
      hint.className = 'gsa-reason';
      try {
        const raw = await llmChat([{ role: 'user', content: '只回复两个字：通了' }]);
        hint.textContent = '✓ 通了：' + String(raw).slice(0, 40);
        hint.className = 'gsa-ok';
      } catch (e) {
        hint.textContent = '✗ ' + e.message;
        hint.className = 'gsa-warn';
      }
    });
    const modelsBtn = buttonRow('拉取模型列表', '', async () => {
      saveCfg({ llmBaseUrl: urlInput.value.trim(), llmApiKey: keyInput.value.trim() });
      hint.textContent = '拉取中…';
      hint.className = 'gsa-reason';
      try {
        const ids = await llmModels();
        if (!ids.length) throw new Error('返回里没有模型');
        modelList.replaceChildren(...ids.map(id => { const o = document.createElement('option'); o.value = id; return o; }));
        hint.textContent = '✓ 拿到 ' + ids.length + ' 个模型，点 Model 输入框可选（例：' + ids.slice(0, 3).join('、') + '）';
        hint.className = 'gsa-ok';
      } catch (e) {
        hint.textContent = '✗ ' + e.message;
        hint.className = 'gsa-warn';
      }
    });
    const btns = el('div', 'gsa-btnrow');
    btns.appendChild(testBtn);
    btns.appendChild(modelsBtn);
    const testRow = el('label', 'wide');
    testRow.appendChild(btns);
    testRow.appendChild(hint);
    field('预设服务商', preset, true);
    field('Base URL', urlInput, true);
    field('Model', modelInput, true);
    box.appendChild(modelList);
    field('API Key（明文存在脚本管理器里）', keyInput, true);
    field('超时秒', num('llmTimeout', 5, 180, 5));
    field('结果缓存小时', num('llmCacheHours', 0, 720, 1));
    field('Temperature', num('llmTemperature', 0, 1, 0.1));
    field('Max tokens', num('llmMaxTokens', 200, 4000, 100));
    box.appendChild(testRow);
    return box;
  }

  function cancelRun() {
    state.runId++;
    state.dismissed = true;
    hidePanel();
  }

  async function showForRepo(force) {
    const cfg = getCfg();
    if (!cfg.enabled || (state.sessionOff && !force)) return;
    const mine = ++state.runId;
    state.dismissed = false;
    const slug = (repoSlugFromUrl() || {}).slug || '';
    const scored = await analyzeFast();
    if (mine !== state.runId || state.dismissed) return;
    if (!scored) { hidePanel(); startProgress(slug); showProgressError(); return; }
    // 快阶段就判定不该打扰时直接静默返回，面板一次都不会闪出来
    if (!force && cfg.onlyWhenNoMatch && hasRealMatch(scored, cfg)) return;
    hidePanel();
    startProgress(slug);
    const res = await analyzeDeep(scored, mine);
    if (mine !== state.runId || state.dismissed) return;
    if (!res) { showProgressError(); return; }
    if (!force && cfg.onlyWhenNoMatch && res.existing.length) { hidePanel(); return; }
    renderPanel();
  }

  function reanalyze() {
    state.sessionOff = false;
    if (!isRepoHeaderPage()) { alert('请在仓库主页使用这个功能'); return; }
    showForRepo(true);
  }

  /* ------------------------- 批量归类（你的 stars 页） ------------------------- */

  function loginName() { return (q('meta[name="user-login"]') || {}).content || ''; }

  function isStarsPage() {
    const login = loginName();
    return !!login && location.pathname === '/' + login && /tab=stars/.test(location.search) && !!q('#user-starred-repos');
  }

  function parseRepoRow(r, nameSel) {
    const a = r.querySelector(nameSel);
    const m = ((a && a.getAttribute('href')) || '').match(/^\/([^/]+)\/([^/?#]+)/);
    if (!m) return null;
    return {
      // 统一成 owner/repo 无空格，否则跨页面的去重会失效
      n: m[1] + '/' + m[2],
      d: clean((r.querySelector('[itemprop="description"]') || {}).textContent),
      l: clean((r.querySelector('[itemprop="programmingLanguage"]') || {}).textContent)
    };
  }

  function fetchDoc(url) {
    return fetch(url, { credentials: 'same-origin' }).then(r => r.text()).then(t => new DOMParser().parseFromString(t, 'text/html'));
  }

  function parseListsFrom(doc) {
    const out = [];
    doc.querySelectorAll('#profile-lists-container a[href*="/lists/"]').forEach(a => {
      const m = (a.getAttribute('href') || '').match(/\/stars\/[^/]+\/lists\/([^/?#]+)/);
      const name = clean((a.querySelector('h3') || {}).textContent || a.textContent);
      if (m && name) out.push({ id: null, name, slug: m[1], description: '', repoIncluded: false, vocabTokens: null, sampleRepos: [], learned: [] });
    });
    return out;
  }

  function parseStarredFrom(doc) {
    const out = [];
    [...doc.querySelectorAll('#user-starred-repos .col-12')].forEach(r => {
      const row = parseRepoRow(r, 'h3 a, h2 a');
      if (!row || out.some(x => x.slug === row.n)) return;
      const [owner, name] = row.n.split('/');
      out.push({ owner, name, slug: row.n, description: row.d, language: row.l, topics: [], readme: '' });
    });
    return out;
  }

  // 分页游标是不透明 base64，只能一页一页跟
  function nextPageHref(doc) {
    const a = [...doc.querySelectorAll('a')].find(e => /^next$/i.test(clean(e.textContent)) && !e.getAttribute('aria-disabled'));
    return a ? a.getAttribute('href') : null;
  }

  async function pool(items, size, worker) {
    const queue = items.slice();
    const run = async () => { while (queue.length) await worker(queue.shift()); };
    await Promise.all(Array.from({ length: Math.min(size, items.length) }, run));
  }

  async function fetchListCorpus(slug) {
    const doc = await fetchDoc('/stars/' + loginName() + '/lists/' + slug);
    const seen = new Set();
    return [...doc.querySelectorAll('#user-list-repositories .col-12')].map(r => parseRepoRow(r, 'h2 a')).filter(r => r && !seen.has(r.n) && seen.add(r.n));
  }

  function planFor(repo, lists, cfg) {
    const scored = scoreLists(repo, lists);
    const s = ruleSuggest(repo, scored, { threshold: cfg.threshold, maxSuggestions: 1, canCreateList: true, nameLang: cfg.nameLang });
    if (s.existing.length) return { kind: 'list', name: s.existing[0].list.name, score: s.existing[0].score, reason: s.existing[0].reasons[0] || '' };
    if (s.newLists.length) return { kind: 'new', name: s.newLists[0].name, description: s.newLists[0].description, reason: s.newLists[0].reason || '', weak: !!s.newLists[0].weak };
    return { kind: 'none' };
  }

  const specOf = plan => (plan.kind === 'new' ? 'new:' + plan.name + '::' + (plan.description || '') : plan.name);

  function readQueue() { const v = GM_getValue(QUEUE_KEY, null); return Array.isArray(v) ? v : null; }
  function writeQueue(v) { GM_setValue(QUEUE_KEY, v); }

  function showFlash(text, ok) {
    ensureStyle();
    hidePanel();
    const p = el('div', 'gsa-panel');
    p.appendChild(el('div', ok ? 'gsa-ok' : 'gsa-warn', text));
    state.panel = p;
    document.body.appendChild(p);
    positionPanel();
  }

  async function openBatch() {
    const cfg = getCfg();
    cancelRun();
    ensureStyle();
    state.anchor = q('.gsa-batch-btn');
    const p = el('div', 'gsa-panel gsa-batch');
    state.panel = p;
    const head = el('div', 'gsa-h');
    head.appendChild(el('span', 'gsa-title', '批量归类未分组的 star'));
    head.appendChild(closeButton());
    p.appendChild(head);
    const body = el('div', 'gsa-batch-body');
    const status = el('div', 'gsa-summary', '读取你的 Lists…');
    body.appendChild(status);
    p.appendChild(body);
    const foot = el('div', 'gsa-foot');
    p.appendChild(foot);
    document.body.appendChild(p);
    positionPanel();

    let lists = [], todo = [], scanned = 0;
    const inLists = new Set();
    try {
      // 第一页 HTML 同时含「我的列表」和「前 30 个 star」，只抓一次
      const first = await fetchDoc('/' + loginName() + '?tab=stars');
      lists = parseListsFrom(first);
      let doneLists = 0;
      await pool(lists, 4, async l => {
        try { const c = await fetchListCorpus(l.slug); applyCorpus(l, c); c.forEach(r => inLists.add(r.n)); } catch (e) { /* 单个失败不阻断 */ }
        status.textContent = '读取列表已有内容… ' + (++doneLists) + '/' + lists.length;
      });
      const picked = [];
      const seen = new Set();
      let doc = first;
      for (let page = 1; doc && page <= 20; page++) {
        for (const r of parseStarredFrom(doc)) {
          scanned++;
          if (!inLists.has(r.slug) && !seen.has(r.slug)) { seen.add(r.slug); picked.push(r); }
        }
        status.textContent = '扫描 star… 已扫 ' + scanned + ' 个，未分组 ' + picked.length;
        if (picked.length >= cfg.batchLimit) break;
        const next = nextPageHref(doc);
        doc = next ? await fetchDoc(next) : null;
      }
      todo = picked.slice(0, cfg.batchLimit);
    } catch (e) {
      status.textContent = '读取失败：' + e.message;
      positionPanel();
      return;
    }

    body.replaceChildren();
    foot.replaceChildren();
    if (!todo.length) {
      body.appendChild(el('div', 'gsa-summary', '扫过的 ' + scanned + ' 个 star 都已在某个列表里了（判断依据：各列表页可见的仓库，长列表可能被截断）'));
      positionPanel();
      return;
    }
    body.appendChild(el('div', 'gsa-summary', '扫过 ' + scanned + ' 个 star，其中 ' + todo.length + ' 个未分组（上限可在设置里调）'));
    const rows = [];
    for (const r of todo) {
      const plan = planFor(r, lists, cfg);
      if (plan.kind === 'none') continue;
      const row = el('div', 'gsa-row');
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = plan.kind === 'list' ? plan.score >= cfg.threshold : !plan.weak;
      const main = el('div', 'gsa-rowmain');
      main.appendChild(el('div', 'gsa-name', r.slug));
      main.appendChild(el('div', 'gsa-reason',
        (plan.kind === 'new' ? '新建「' + plan.name + '」' : '加入「' + plan.name + '」' + (plan.score ? ' · ' + Math.round(plan.score * 100) + '%' : '')) +
        (plan.reason ? '（' + plan.reason + '）' : '') + (plan.weak ? ' · 依据太弱，默认不选' : '')));
      row.appendChild(cb);
      row.appendChild(main);
      rows.push({ cb, spec: specOf(plan), slug: r.slug });
      body.appendChild(row);
    }
    const note = el('span', 'gsa-reason', '会依次跳转每个仓库页并驱动原生面板，中途关页面即停');
    foot.appendChild(buttonRow('依次应用所选', 'primary', () => {
      const items = rows.filter(x => x.cb.checked).map(x => ({ slug: x.slug, spec: x.spec }));
      if (!items.length) { note.textContent = '一个都没勾'; note.className = 'gsa-warn'; return; }
      writeQueue(items.slice(1));
      location.href = '/' + items[0].slug + '?gsa_apply=' + encodeURIComponent(items[0].spec);
    }));
    foot.appendChild(note);
    // 撑高之后必须重算位置，否则面板底边会跑到视口外
    positionPanel();
  }

  // 仓库页带 ?gsa_apply= 时自动执行一次归类，然后接着跑队列里的下一个
  async function applyFromUrl() {
    const spec = new URLSearchParams(location.search).get('gsa_apply');
    if (!spec) return;
    history.replaceState({}, '', location.pathname + location.hash);
    try {
      await waitUntil(() => starButton() && q('[data-testid="star-dropdown-button"]'), 15000);
      if (spec.startsWith('new:')) {
        const parts = spec.slice(4).split('::');
        const v = await createListAndAdd(parts[0], parts[1] || '');
        showFlash(v.ok ? '已建好并加入「' + parts[0] + '」' : '建好了但归属没确认，请手动勾', v.ok);
      } else {
        const data = await fetchLists();
        const hit = data.lists.find(l => l.name.toLowerCase() === spec.toLowerCase());
        if (!hit) throw new Error('找不到列表「' + spec + '」');
        const v = await addToList(hit.id);
        showFlash(v.ok ? '已加入「' + hit.name + '」' : '点了但没生效，请手动勾', v.ok);
      }
    } catch (e) {
      writeQueue(null);
      showFlash('应用失败：' + e.message, false);
      return;
    }
    const rest = readQueue();
    if (rest && rest.length) {
      const next = rest.shift();
      writeQueue(rest);
      await sleep(1200);
      location.href = '/' + next.slug + '?gsa_apply=' + encodeURIComponent(next.spec);
    } else {
      writeQueue(null);
    }
  }

  /* ------------------------------ 挂载与诊断 ------------------------------ */

  // 页面上的常驻入口：仓库头部一个按钮。React 重渲染可能把它带走，所以每次 DOM 变动都幂等地补回来
  function ensureHeaderButton() {
    ensureStyle();
    const want = getCfg().showButton && isRepoHeaderPage();
    const cur = q('.gsa-open');
    if (!want) { if (cur) (cur.closest('li') || cur).remove(); return; }
    if (cur && cur.isConnected) return;
    const group = q('[data-testid="repo-header-actions"]');
    const star = starButton();
    if (!group || !star) return;
    if (cur) (cur.closest('li') || cur).remove();
    const li = document.createElement('li');
    const b = el('button', 'gsa-open');
    b.type = 'button';
    b.appendChild(el('i', '', '✦'));
    b.appendChild(document.createTextNode('归类推荐'));
    b.title = '分析这个项目并推荐要加入的 List';
    b.addEventListener('click', () => {
      if (state.panel && state.panel.isConnected) { cancelRun(); return; }
      reanalyze();
    });
    li.appendChild(b);
    (star.closest('li') || group.lastElementChild).after(li);
  }

  function ensureBatchButton() {
    ensureStyle();
    const want = getCfg().showButton && isStarsPage();
    const cur = q('.gsa-batch-btn');
    if (!want) { if (cur) cur.remove(); return; }
    if (cur && cur.isConnected) return;
    if (cur) cur.remove();
    const search = q('.subnav-search');
    if (!search || !search.parentNode) return;
    const b = el('button', 'gsa-btn gsa-batch-btn', '✦ 批量归类未分组');
    b.type = 'button';
    b.style.marginLeft = '8px';
    b.title = '扫描没进任何 List 的 star，一次性给出归类计划';
    b.addEventListener('click', openBatch);
    search.parentNode.insertBefore(b, search.nextSibling);
  }

  function attach() {
    ensureHeaderButton();
    ensureBatchButton();
    if (!isRepoHeaderPage()) return;
    const btn = starButton();
    if (!btn || btn.dataset.gsaBound) return;
    btn.dataset.gsaBound = '1';
    btn.addEventListener('click', async () => {
      if (state.driving) return;
      const was = isStarred();
      // star 请求走代理可能要好几秒，轮询窗口给足 8 秒，否则慢网络上面板根本不出现
      for (let i = 0; i < 40; i++) {
        await sleep(200);
        const now = isStarred();
        if (now === was) continue;
        if (now) showForRepo();
        else hidePanel();
        return;
      }
    });
  }

  // 调试入口：不点 Star 也能跑一遍自动路径（force=true 会忽略「只在没匹配时弹出」）
  window.gsaRun = force => showForRepo(!!force);
  window.gsaDiag = () => ({
    repo: state.repo,
    lists: (state.listsData && state.listsData.lists) || null,
    listsMeta: state.listsData ? { repoIsOnAnyList: state.listsData.repoIsOnAnyList, canCreateList: state.listsData.canCreateList, createPath: state.listsData.createPath } : null,
    scored: (state.scored || []).map(s => ({ name: s.list.name, score: Number(s.score.toFixed(3)), category: s.category, catchAll: s.catchAll, reasons: s.reasons })),
    result: state.result,
    lastError: state.lastError,
    vocabNote: state.vocabNote,
    cfg: getCfg(),
    pageHasStarButton: !!starButton(),
    repoHeader: isRepoHeaderPage()
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && state.panel && !state.driving) cancelRun();
    if (e.altKey && (e.key === 'l' || e.key === 'L')) { e.preventDefault(); reanalyze(); }
  });

  if (typeof GM_registerMenuCommand === 'function') {
    try {
      GM_registerMenuCommand('重新分析本页（推荐 List）', reanalyze);
      GM_registerMenuCommand('本次会话停止自动弹出', () => { state.sessionOff = true; cancelRun(); });
    } catch (e) { /* 管理器不支持菜单就不挂 */ }
  }
  window.addEventListener('resize', positionPanel);
  window.addEventListener('turbo:load', () => {
    attach();
    const slug = (repoSlugFromUrl() || {}).slug || null;
    if (!state.renderedFor) return;
    if (state.renderedFor !== slug) { hidePanel(); state.result = null; return; }
    // GitHub 首次加载也会派发 turbo:load 且可能替换 body 子节点：同仓库时把面板接回去，而不是隐藏
    if (state.panel && !state.panel.isConnected) { document.body.appendChild(state.panel); positionPanel(); }
  });

  let moTimer = null;
  new MutationObserver(() => {
    if (moTimer) return;
    moTimer = setTimeout(() => { moTimer = null; try { attach(); } catch (e) {} }, 500);
  }).observe(document.documentElement, { childList: true, subtree: true });

  window.gsaBatch = openBatch;
  attach();
  applyFromUrl();
})();
