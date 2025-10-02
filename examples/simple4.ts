import { EventBus } from '../src/index.ts';

type MyEvents = {
  userCreated: UserCreatedEvent;
};

interface UserCreatedEvent {
  age?: number;
  name: string;
}

const bus = new EventBus<MyEvents>();

bus.on(
  'userCreated',
  (ctx) => {
    console.log('v1 handler', ctx.meta);
  },
  1,
);

bus.on(
  'userCreated',
  (ctx) => {
    console.log('v2 handler', ctx.meta);
  },
  2,
);

bus.registerMigrator('userCreated', 1, (ctx) => {
  if (!ctx.meta?.name) {
    throw new Error('Name is required for userCreated event');
  }

  return {
    ...ctx,
    meta: {
      ...ctx.meta,
      age: ctx.meta?.age ?? 18,
    },
  };
});

bus.emit('userCreated', { meta: { name: 'Alice' }, version: 1 });
