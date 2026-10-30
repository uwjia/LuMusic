// 简体中文文案。类型 `Record<MessageKey, string>` 强制与英文词典的
// 键集合完全一致：漏译或多余的键都会在 typecheck 阶段报错。

import type { MessageKey } from '@/i18n/locales/en';

export const zhCN: Record<MessageKey, string> = {
  // 侧边栏导航
  'nav.navigation': '导航',
  'nav.library': '音乐库',
  'nav.playlists': '歌单',
  'nav.newPlaylist': '＋ 新建歌单',
  'nav.newPlaylistName': '新歌单名称',
  'nav.add': '添加',
  'nav.settings': '设置',

  // 标题栏窗口控制
  'titlebar.minimize': '最小化',
  'titlebar.maximize': '最大化',
  'titlebar.restore': '还原',
  'titlebar.close': '关闭',

  // 音乐库页面
  'library.searchPlaceholder': '搜索标题、艺术家、专辑…',
  'library.searchLabel': '搜索曲目',
  'library.trackCount': '{count} 首曲目',
  'library.trackCountOne': '{count} 首曲目',
  'library.loadingSuffix': ' · 加载中…',
  'library.manage': '管理音乐库',
  'library.scanning': '正在扫描… {scanned}/{total}',
  'library.noMatches': '没有匹配的结果',
  'library.noMatchesHint': '换个关键词试试。',
  'library.empty': '音乐库还是空的',
  'library.emptyHint': '在设置中选择音乐文件夹并扫描。',
  'library.refresh': '刷新',

  // 曲目表格
  'table.tracks': '曲目列表',
  'table.index': '#',
  'table.title': '标题',
  'table.artist': '艺术家',
  'table.album': '专辑',
  'table.duration': '时长',
  'table.playing': '正在播放',
  'table.emptyTitle': '还没有曲目',
  'table.emptyHint': '扫描一个音乐文件夹来填充你的音乐库。',

  // 播放控制栏
  'player.loading': '正在加载播放器…',
  'player.unknownArtist': '未知艺术家',
  'player.nothingPlaying': '暂无播放',
  'player.shuffle': '随机播放',
  'player.prev': '上一曲',
  'player.play': '播放',
  'player.pause': '暂停',
  'player.next': '下一曲',
  'player.modeSequential': '顺序播放',
  'player.repeatAll': '列表循环',
  'player.repeatOne': '单曲循环',
  'player.seek': '进度',
  'player.volume': '音量',

  // 歌单页面
  // 固定自动歌单在后端保留 canonical 名（domain/scan.rs 的 All Tracks / Default），
  // 这两个键仅在展示层本地化，不写回后端。
  'playlist.allTracks': '全部曲目',
  'playlist.defaultPlaylist': '默认歌单',
  'playlist.notFound': '歌单不存在',
  'playlist.trackCount': '{count} 首曲目',
  'playlist.trackCountOne': '{count} 首曲目',
  'playlist.nameLabel': '歌单名称',
  'playlist.save': '保存',
  'playlist.actions': '歌单操作',
  'playlist.rename': '重命名',
  'playlist.duplicate': '创建副本',
  'playlist.delete': '删除歌单',
  'playlist.empty': '该歌单为空',
  'playlist.emptyHint': '在音乐库中点击每行的 ＋ 按钮添加曲目。',
  'playlist.removeTrack': '从歌单移除 {title}',
  'playlist.copyName': '{name}（副本）',
  'playlist.copyNameN': '{name}（副本 {n}）',

  // 设置页面
  'settings.library': '音乐库',
  'settings.musicFolder': '音乐文件夹',
  'settings.browse': '浏览…',
  'settings.scanFolder': '扫描文件夹',
  'settings.scanning': '正在扫描…',
  'settings.lastScan':
    '上次扫描 {root}：共 {filesSeen} 个文件 · 新增 {added} · 更新 {updated} · 移除 {removed} · 跳过 {skipped}',
  'settings.about': '关于',
  'settings.aboutText': '支持的格式：MP3、FLAC、WAV、OGG。设置与音乐库缓存保存在应用数据目录中。',
  'settings.language': '语言',
};
