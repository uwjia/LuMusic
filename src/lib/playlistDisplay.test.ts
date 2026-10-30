// Unit tests for the auto-playlist display-name mapping.
import { describe, expect, it } from 'vitest';
import { t, translate } from '@/i18n';
import { displayPlaylistName } from '@/lib/playlistDisplay';
import type { Playlist } from '@/types/track';

const pl = (id: string, name: string): Pick<Playlist, 'id' | 'name'> => ({ id, name });

describe('displayPlaylistName', () => {
  it('localizes the fixed auto playlists by their stable ids', () => {
    expect(displayPlaylistName(pl('auto:all', 'All Tracks'), translate.bind(null, 'zh-CN'))).toBe(
      '全部曲目',
    );
    expect(displayPlaylistName(pl('auto:root', 'Default'), translate.bind(null, 'zh-CN'))).toBe(
      '默认歌单',
    );
  });

  it('keeps the stored English names in the en locale', () => {
    expect(displayPlaylistName(pl('auto:all', 'All Tracks'), t)).toBe('All Tracks');
    expect(displayPlaylistName(pl('auto:root', 'Default'), t)).toBe('Default');
  });

  it('shows folder-derived auto playlists and manual playlists verbatim', () => {
    // Folder names are user data - never rewritten in any locale.
    expect(displayPlaylistName(pl('auto:dir:周杰伦', '周杰伦'), translate.bind(null, 'zh-CN'))).toBe(
      '周杰伦',
    );
    expect(displayPlaylistName(pl('pl-1', 'Chill'), translate.bind(null, 'zh-CN'))).toBe('Chill');
  });

  it('does not localize a manual playlist that happens to be named Default', () => {
    // A manual playlist with the same *name* has a different id and must
    // keep its stored name - only the canonical ids are display-mapped.
    expect(displayPlaylistName(pl('pl-9', 'Default'), translate.bind(null, 'zh-CN'))).toBe('Default');
  });
});
