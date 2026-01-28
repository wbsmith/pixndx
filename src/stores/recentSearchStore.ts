import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { getCurrentUser } from 'aws-amplify/auth';
import { generateClient } from 'aws-amplify/data';
import { IS_LOCAL_DEV } from '@/config';
import type { LayoutType, SimilarityConfig } from '@/types/gallery';
import type { SortMode, ForceSettings, ColorMode } from './galleryStore';
import type { Schema } from '../../amplify/data/resource';

// Keep localStorage reasonable - this is just a cache, DB is source of truth
const MAX_LOCAL_SEARCHES = 100;

export interface RecentSearch {
  id: string;
  query: string;
  timestamp: number;
  // Layout state to restore
  layout: LayoutType;
  sortMode: SortMode;
  // Graph-specific settings (only captured when layout was network)
  graphSettings?: {
    similarity: SimilarityConfig;
    forceSettings: ForceSettings;
    colorMode: ColorMode;
  };
  // Analytics
  resultCount?: number;
}

interface RecentSearchState {
  // Searches keyed by userId (or 'local' for dev mode)
  searchesByUser: Record<string, RecentSearch[]>;
}

interface RecentSearchActions {
  addSearch: (search: Omit<RecentSearch, 'id' | 'timestamp'>) => Promise<void>;
  getRecentSearches: () => Promise<RecentSearch[]>;
  clearSearches: () => Promise<void>;
}

type RecentSearchStore = RecentSearchState & RecentSearchActions;

// Lazy client initialization
let _client: ReturnType<typeof generateClient<Schema>> | null = null;
function getClient() {
  if (!_client && !IS_LOCAL_DEV) {
    _client = generateClient<Schema>();
  }
  return _client;
}

// Get current user ID (or 'local' for dev mode)
async function getUserKey(): Promise<string> {
  if (IS_LOCAL_DEV) return 'local';
  try {
    const { userId } = await getCurrentUser();
    return userId;
  } catch {
    return 'anonymous';
  }
}

// Write search to DynamoDB (async, non-blocking)
async function persistSearchToDb(search: RecentSearch): Promise<void> {
  if (IS_LOCAL_DEV) return;

  try {
    const client = getClient();
    if (!client) return;

    await client.models.SearchQuery.create({
      query: search.query,
      layout: search.layout,
      sortMode: search.sortMode,
      graphSettings: search.graphSettings ? JSON.stringify(search.graphSettings) : null,
      resultCount: search.resultCount,
    });
  } catch (error) {
    // Log but don't fail - DB write is best-effort analytics
    console.warn('[RecentSearchStore] Failed to persist search to DB:', error);
  }
}

export const useRecentSearchStore = create<RecentSearchStore>()(
  persist(
    (set, get) => ({
      searchesByUser: {},

      addSearch: async (searchData) => {
        const userKey = await getUserKey();
        const { searchesByUser } = get();
        const userSearches = searchesByUser[userKey] || [];

        // Don't add empty queries or special queries
        if (!searchData.query.trim() || searchData.query.startsWith('__')) {
          return;
        }

        // Check if this exact query already exists
        const existingIndex = userSearches.findIndex(
          (s) => s.query.toLowerCase() === searchData.query.toLowerCase()
        );

        const newSearch: RecentSearch = {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          timestamp: Date.now(),
          ...searchData,
        };

        let updatedSearches: RecentSearch[];
        if (existingIndex >= 0) {
          // Move existing to top with updated settings
          updatedSearches = [
            newSearch,
            ...userSearches.slice(0, existingIndex),
            ...userSearches.slice(existingIndex + 1),
          ];
        } else {
          // Add new search at top
          updatedSearches = [newSearch, ...userSearches];
        }

        // Limit localStorage to reasonable size
        updatedSearches = updatedSearches.slice(0, MAX_LOCAL_SEARCHES);

        set({
          searchesByUser: {
            ...searchesByUser,
            [userKey]: updatedSearches,
          },
        });

        // Persist to DynamoDB async (fire and forget)
        persistSearchToDb(newSearch);
      },

      getRecentSearches: async () => {
        const userKey = await getUserKey();
        const { searchesByUser } = get();
        return searchesByUser[userKey] || [];
      },

      clearSearches: async () => {
        const userKey = await getUserKey();
        const { searchesByUser } = get();
        set({
          searchesByUser: {
            ...searchesByUser,
            [userKey]: [],
          },
        });
      },
    }),
    {
      name: 'picgraf-recent-searches',
    }
  )
);
