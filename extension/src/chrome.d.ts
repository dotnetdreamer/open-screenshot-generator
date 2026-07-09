/**
 * The slice of the extension API this project uses. Hand-written so the repo
 * does not need @types/chrome as a dependency for four small files.
 */
declare namespace chrome {
  namespace runtime {
    const id: string;
    function getManifest(): { version: string; [key: string]: unknown };
    function sendMessage<T = unknown, R = unknown>(message: T): Promise<R>;
    const lastError: { message?: string } | undefined;
    const onMessage: {
      addListener(
        callback: (
          message: any,
          sender: { tab?: { id?: number } },
          sendResponse: (response?: any) => void
        ) => boolean | void
      ): void;
    };
  }

  namespace tabs {
    interface Tab {
      id?: number;
      url?: string;
      status?: string;
      active?: boolean;
    }
    function query(query: { url?: string | string[] }): Promise<Tab[]>;
    function create(options: { url: string; active?: boolean }): Promise<Tab>;
    function get(tabId: number): Promise<Tab>;
    function update(tabId: number, options: { active?: boolean; url?: string }): Promise<Tab>;
    function sendMessage<T = unknown, R = unknown>(tabId: number, message: T): Promise<R>;
    const onUpdated: {
      addListener(
        callback: (tabId: number, changeInfo: { status?: string }, tab: Tab) => void
      ): void;
      removeListener(callback: (...args: any[]) => void): void;
    };
  }

  namespace scripting {
    function executeScript(injection: {
      target: { tabId: number };
      files: string[];
    }): Promise<unknown[]>;
  }
}
