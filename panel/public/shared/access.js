// The backend remains authoritative. These helpers only present permitted tools.
export const can = (user, permission) =>
  (permission === 'account.self' && !!user) ||
  user?.role === 'admin' ||
  (user?.role === 'member' && user.permissions?.includes(permission) === true);
export const delegated = (user) => user?.role === 'member';
const itemPermission = (item, user) =>
  item.permission
    ? can(user, item.permission)
    : item.permissionsAny?.some((permission) => can(user, permission)) === true;
export const navigationAllowed = (item, user) =>
  (!item.adminOnly ||
    user?.role === 'admin' ||
    (user?.role === 'member' && itemPermission(item, user))) &&
  (!item.ownerOnly || !delegated(user)) &&
  (user?.role !== 'member' ||
    (!item.permission && !item.permissionsAny) ||
    itemPermission(item, user));

export const canAction = (user, action) =>
  user?.role === 'admin' ||
  (user?.role === 'member' && user.allowedActions?.includes(action) === true);
