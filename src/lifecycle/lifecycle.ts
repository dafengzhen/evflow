import type { Event } from '../core/event.ts';
import type { LifecycleHook, LifecyclePhase, MiddlewareContext } from '../types.ts';

export class Lifecycle {
  private eventHooks = new Map<string, Map<LifecyclePhase, LifecycleHook[]>>();

  private globalHooks = new Map<LifecyclePhase, LifecycleHook[]>();

  clear() {
    this.globalHooks.clear();
    this.eventHooks.clear();
  }

  registerForEvent(eventId: string, phase: LifecyclePhase, hook: LifecycleHook) {
    const eventMap = this.eventHooks.get(eventId) ?? new Map();
    if (!this.eventHooks.has(eventId)) {
      this.eventHooks.set(eventId, eventMap);
    }

    const hooks = eventMap.get(phase) ?? [];
    if (!eventMap.has(phase)) {
      eventMap.set(phase, hooks);
    }

    hooks.push(hook);
  }

  registerGlobal(phase: LifecyclePhase, hook: LifecycleHook) {
    const hooks = this.globalHooks.get(phase) ?? [];
    if (!this.globalHooks.has(phase)) {
      this.globalHooks.set(phase, hooks);
    }

    hooks.push(hook);
  }

  async trigger(event: Event, phase: LifecyclePhase, context: MiddlewareContext) {
    const global = this.globalHooks.get(phase);
    const specific = this.eventHooks.get(event.context.id)?.get(phase);

    if (global) {
      for (const hook of global) {
        await hook(event, context);
      }
    }

    if (specific) {
      for (const hook of specific) {
        await hook(event, context);
      }
    }
  }
}
