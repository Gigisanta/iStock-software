import { Config } from '@remotion/cli/config';

Config.setChromiumOpenGlRenderer('angle');
Config.overrideWebpackConfig((config) => {
  const aliases = config.resolve?.alias;
  if (aliases && !Array.isArray(aliases)) {
    const studioEntry = aliases['@remotion/studio'];
    if (typeof studioEntry === 'string') {
      delete aliases['@remotion/studio'];
      aliases['@remotion/studio$'] = studioEntry;
    }
  }
  return config;
});
