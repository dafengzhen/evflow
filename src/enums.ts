export enum LifecyclePhase {
  BEFORE_EMIT = 'beforeEmit',
  AFTER_EMIT = 'afterEmit',
  BEFORE_HANDLER = 'beforeHandler',
  AFTER_HANDLER = 'afterHandler',
  BEFORE_MIDDLEWARE = 'beforeMiddleware',
  AFTER_MIDDLEWARE = 'afterMiddleware',
  ERROR_HANDLING = 'errorHandling',
  TIMEOUT = 'timeout',
  NO_HANDLERS = 'noHandlers',
}
