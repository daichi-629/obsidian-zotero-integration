import api from 'zotero-api-client';

import { WebApiLibraryType } from '../types';

export type WebApiClientOptions = {
  apiKey: string;
  libraryType: WebApiLibraryType;
  userId?: string;
  groupId?: string;
};

export class WebApiClient {
  private libraryApi: any;

  constructor(options: WebApiClientOptions) {
    const libraryId =
      options.libraryType === 'group' ? options.groupId : options.userId;
    this.libraryApi = api(options.apiKey).library(
      options.libraryType,
      libraryId
    );
  }

  getLibraryApi() {
    return this.libraryApi;
  }
}
