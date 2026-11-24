import * as migration_20261124_072117_initial from './20261124_072117_initial';

export const migrations = [
  {
    up: migration_20261124_072117_initial.up,
    down: migration_20261124_072117_initial.down,
    name: '20261124_072117_initial'
  },
];
