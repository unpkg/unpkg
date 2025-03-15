import semver from 'semver';

import asyncHandler from '../utils/asyncHandler.js';
import createPackageURL from '../utils/createPackageURL.js';
import { getPackageConfig, getVersionsAndTags } from '../utils/npm.js';

function semverRedirect(req, res, newVersion) {
  res
    .set({
      'Cache-Control': 'public, s-maxage=600, max-age=60', // 10 mins on CDN, 1 min on clients
      'Cache-Tag': 'redirect, semver-redirect'
    })
    .redirect(
      302,
      req.baseUrl +
        createPackageURL(req.packageName, newVersion, req.filename, req.query)
    );
}

async function resolveVersion(packageName, range, authorization, log) {
  const versionsAndTags = await getVersionsAndTags(packageName, authorization, log);

  if (versionsAndTags) {
    const { versions, tags } = versionsAndTags;

    if (range in tags) {
      range = tags[range];
    }

    return versions.includes(range)
      ? range
      : semver.maxSatisfying(versions, range);
  }

  return null;
}

/**
 * Check the package version/tag in the URL and make sure it's good. Also
 * fetch the package config and add it to req.packageConfig. Redirect to
 * the resolved version number if necessary.
 */
async function validateVersion(req, res, next) {
  const version = await resolveVersion(
    req.packageName,
    req.packageVersion,
    req.headers.authorization,
    req.log
  );

  if (!version) {
    return res
      .status(404)
      .type('text')
      .send(`Cannot find package ${req.packageSpec}`);
  }

  if (version !== req.packageVersion) {
    return semverRedirect(req, res, version);
  }

  req.packageConfig = await getPackageConfig(
    req.packageName,
    req.packageVersion,
    req.headers.authorization,
    req.log
  );

  if (!req.packageConfig) {
    return res
      .status(500)
      .type('text')
      .send(`Cannot get config for package ${req.packageSpec}`);
  }

  next();
}

export default asyncHandler(validateVersion);
