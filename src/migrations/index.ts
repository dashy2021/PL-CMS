import * as migration_20261124_072117_initial from './20261124_072117_initial';
import * as migration_20261126_082052_media_centre from './20261126_082052_media_centre';

export const migrations = [
  {
    up: migration_20261124_072117_initial.up,
    down: migration_20261124_072117_initial.down,
    name: '20261124_072117_initial',
  },
  {
    up: migration_20261126_082052_media_centre.up,
    down: migration_20261126_082052_media_centre.down,
    name: '20261126_082052_media_centre'
  },
];
