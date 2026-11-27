import type {ClientScope} from "./index";
export const operationsKey = (scope: ClientScope, resource: string, input: object) => ["stallorder", "v1", scope.environment, scope.principalKey, scope.sessionEpoch, scope.permissionRevision, scope.context, resource, input] as const;
