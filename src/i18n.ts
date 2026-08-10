/**
 * Storyboard Reference Studio Internationalization (i18n)
 * 支持英文/中文双语切换
 */

const translations = {
  en: {
    // 应用标题
    'app.title': 'Storyboard Reference Studio',
    'app.subtitle': 'AI-Ready Storyboard Creator',

    // 项目
    'project.new': 'New Project',
    'project.open': 'Open',
    'project.save': 'Save',
    'project.export': 'Export',
    'project.import': 'Import Image',
    'project.untitled': 'Untitled Project',

    // 工具栏
    'tool.select': 'Select',
    'tool.pan': 'Pan',
    'tool.frame': 'Add Frame',
    'tool.text': 'Add Text',
    'tool.camera': 'Camera Movement',
    'tool.link': 'Add Link',

    // 资源面板
    'assets.title': 'Assets',
    'assets.search': 'Search assets…',
    'assets.filter.all': 'All',
    'assets.filter.images': 'Images',
    'assets.filter.videos': 'Videos',
    'assets.upload': 'Upload',

    // 分镜板
    'storyboard.title': 'Storyboard',
    'storyboard.addFrame': 'Add Frame',
    'storyboard.deleteFrame': 'Delete Frame',
    'storyboard.duplicateFrame': 'Duplicate Frame',
    'storyboard.reorder': 'Reorder',

    // 帧属性
    'frame.prompt': 'Prompt',
    'frame.negativePrompt': 'Negative Prompt',
    'frame.cameraMovement': 'Camera Movement',
    'frame.notes': 'Notes',
    'frame.duration': 'Duration',
    'frame.aspectRatio': 'Aspect Ratio',

    // 导出
    'export.title': 'Export Options',
    'export.format': 'Format',
    'export.pdf': 'PDF Storyboard',
    'export.images': 'Image Sequence',
    'export.csv': 'Shot List CSV',
    'export.promptPack': 'Prompt Pack',
    'export.animatic': 'Animatic Video',
    'export.download': 'Download',

    // 帮助
    'help.title': 'Help',
    'help.shortcuts': 'Keyboard Shortcuts',
    'help.about': 'About',

    // 对话框
    'dialog.confirm': 'Confirm',
    'dialog.cancel': 'Cancel',
    'dialog.delete': 'Delete',
    'dialog.save': 'Save',

    // Toast
    'toast.saved': 'Project saved',
    'toast.exported': 'Export complete',
    'toast.error': 'An error occurred',
  },

  zh: {
    // 应用标题
    'app.title': '分镜参考工作室',
    'app.subtitle': 'AI 分镜创建工具',

    // 项目
    'project.new': '新建项目',
    'project.open': '打开',
    'project.save': '保存',
    'project.export': '导出',
    'project.import': '导入图片',
    'project.untitled': '未命名项目',

    // 工具栏
    'tool.select': '选择',
    'tool.pan': '平移',
    'tool.frame': '添加帧',
    'tool.text': '添加文本',
    'tool.camera': '镜头运动',
    'tool.link': '添加链接',

    // 资源面板
    'assets.title': '资源',
    'assets.search': '搜索资源…',
    'assets.filter.all': '全部',
    'assets.filter.images': '图片',
    'assets.filter.videos': '视频',
    'assets.upload': '上传',

    // 分镜板
    'storyboard.title': '分镜板',
    'storyboard.addFrame': '添加帧',
    'storyboard.deleteFrame': '删除帧',
    'storyboard.duplicateFrame': '复制帧',
    'storyboard.reorder': '重新排序',

    // 帧属性
    'frame.prompt': '提示词',
    'frame.negativePrompt': '负向提示词',
    'frame.cameraMovement': '镜头运动',
    'frame.notes': '备注',
    'frame.duration': '时长',
    'frame.aspectRatio': '宽高比',

    // 导出
    'export.title': '导出选项',
    'export.format': '格式',
    'export.pdf': 'PDF 故事板',
    'export.images': '图片序列',
    'export.csv': '镜头列表 CSV',
    'export.promptPack': '提示词包',
    'export.animatic': '动态预览视频',
    'export.download': '下载',

    // 帮助
    'help.title': '帮助',
    'help.shortcuts': '快捷键',
    'help.about': '关于',

    // 对话框
    'dialog.confirm': '确认',
    'dialog.cancel': '取消',
    'dialog.delete': '删除',
    'dialog.save': '保存',

    // Toast
    'toast.saved': '项目已保存',
    'toast.exported': '导出完成',
    'toast.error': '发生错误',
  }
};

// 获取当前语言
function getCurrentLang() {
  return localStorage.getItem('storyboard-lang') || 'zh';
}

// 设置语言
function setLang(lang) {
  localStorage.setItem('storyboard-lang', lang);
  window.dispatchEvent(new CustomEvent('langchange', { detail: lang }));
}

// 翻译函数
function t(key) {
  const lang = getCurrentLang();
  return translations[lang]?.[key] || translations['en'][key] || key;
}

// 翻译所有带 data-i18n 属性的元素
function translatePage() {
  const lang = getCurrentLang();
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    if (translations[lang]?.[key]) {
      el.textContent = translations[lang][key];
    }
  });

  document.querySelectorAll('.lang-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.lang === lang);
  });
}

// 初始化 i18n
function initI18n() {
  // 默认设置为中文（强制）
  const savedLang = localStorage.getItem('storyboard-lang');
  if (!savedLang || savedLang === 'en') {
    localStorage.setItem('storyboard-lang', 'zh');
  }

  window.addEventListener('langchange', () => {
    translatePage();
  });

  translatePage();
}

// 导出给全局使用
window.t = t;
window.setLang = setLang;
window.getCurrentLang = getCurrentLang;
window.initI18n = initI18n;
