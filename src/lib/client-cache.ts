import { Button } from "./db";
import { Announcement, AppBootstrapData } from "./actions";

export interface CachedUser {
  name: string;
  email: string;
  roles: string[];
  activeRole: string;
}

interface ClientStoreState {
  user: CachedUser | null;
  buttons: Button[];
  isLoaded: boolean;
  homeSettings: { type: string; value: string } | undefined;
  favorites: number[] | undefined;
  announcements: Announcement[] | undefined;
}

const store: ClientStoreState = {
  user: null,
  buttons: [],
  isLoaded: false,
  homeSettings: undefined,
  favorites: undefined,
  announcements: undefined,
};

export function getClientStore(): Readonly<ClientStoreState> {
  return store;
}

export function setClientStoreBootstrap(data: AppBootstrapData): void {
  store.user = data.user;
  store.isLoaded = true;
  store.homeSettings = data.homeSettings;
  store.favorites = data.favorites;
  store.announcements = data.announcements;
  if (data.buttons && data.buttons.length > 0) {
    store.buttons = data.buttons;
  }
}

export function setClientStoreUser(user: CachedUser | null): void {
  store.user = user;
  store.isLoaded = true;
}

export function setClientStoreButtons(buttons: Button[]): void {
  store.buttons = buttons;
}

export function resetClientStore(): void {
  store.user = null;
  store.favorites = undefined;
  store.isLoaded = true;
}

