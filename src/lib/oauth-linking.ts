export type OAuthLinkProfile = {
  id: string;
  authUserId: string | null;
  passwordHash: string | null;
};

export function resolveOAuthLinkProfile<T extends OAuthLinkProfile>(
  authUserId: string,
  byAuthId: T | null,
  byEmail: T | null,
  options: { allowPasswordProfileLink?: boolean } = {},
) {
  if (byAuthId && byEmail && byAuthId.id !== byEmail.id) throw new Error("OAUTH_ACCOUNT_CONFLICT");
  if (byEmail?.authUserId && byEmail.authUserId !== authUserId) throw new Error("OAUTH_ACCOUNT_CONFLICT");
  if (byAuthId) return byAuthId;
  if (byEmail?.passwordHash && !options.allowPasswordProfileLink) throw new Error("OAUTH_ACCOUNT_CONFLICT");
  return byEmail;
}

export function resolveProjectOAuthLinkProfile<T extends OAuthLinkProfile>(
  authUserId: string,
  authProjectCode: string,
  byProjectIdentity: T | null,
  byPrimaryAuthId: T | null,
  byEmail: T | null,
  options: { allowPasswordProfileLink?: boolean } = {},
) {
  if (authProjectCode === "PRIMARY") {
    return resolveOAuthLinkProfile(authUserId, byPrimaryAuthId, byEmail, options);
  }

  if (byProjectIdentity && byEmail && byProjectIdentity.id !== byEmail.id) {
    throw new Error("OAUTH_ACCOUNT_CONFLICT");
  }
  return byProjectIdentity ?? byEmail;
}
