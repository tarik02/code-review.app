type QueryPrimitive = string | number | boolean;
type QueryValue = QueryPrimitive | null | undefined | ReadonlyArray<QueryPrimitive>;

type QueryParams = Record<string, QueryValue>;
type EmptyQuery = Record<never, never>;
type RouteDefinition = {
  query?: QueryParams;
};
type RouteMap = Record<string, RouteDefinition>;

type RawPathParam = {
  readonly raw: string;
};

type ParamValue = string | number | boolean | RawPathParam;

type PathParamNames<TPath extends string> = TPath extends `${string}:${infer TParam}/${infer TRest}`
  ? TParam | PathParamNames<`/${TRest}`>
  : TPath extends `${string}:${infer TParam}`
    ? TParam
    : never;

type PathParams<TPath extends string> = [PathParamNames<TPath>] extends [never]
  ? Record<never, never>
  : {
      [TParam in PathParamNames<TPath>]: ParamValue;
    };

type BuildRouteOptions<TPath extends string, TQuery extends QueryParams> = ([
  PathParamNames<TPath>,
] extends [never]
  ? { params?: never }
  : { params: PathParams<TPath> }) &
  (keyof TQuery extends never ? { query?: never } : { query?: TQuery });

type RouteQuery<
  TRoutes extends RouteMap,
  TPath extends keyof TRoutes & string,
> = TRoutes[TPath] extends { query: infer TQuery extends QueryParams } ? TQuery : EmptyQuery;

function rawPathParam(value: string): RawPathParam {
  return { raw: value };
}

function renderPathParam(value: ParamValue): string {
  if (typeof value === 'object' && value !== null && 'raw' in value) {
    return value.raw;
  }

  return encodeURIComponent(String(value));
}

function replacePathParams<TPath extends string>(path: TPath, params: PathParams<TPath>): string {
  return path.replaceAll(/:([A-Za-z0-9_]+)/g, (_match, key: string) => {
    const value = params[key as keyof typeof params];
    if (value === undefined) {
      throw new Error(`Missing route param: ${key}`);
    }

    return renderPathParam(value as ParamValue);
  });
}

function appendQuery(path: string, query: QueryParams | undefined): string {
  if (!query) {
    return path;
  }

  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === null || value === undefined) {
      continue;
    }

    params.set(key, Array.isArray(value) ? value.join(',') : String(value));
  }

  const suffix = params.toString();
  return suffix ? `${path}?${suffix}` : path;
}

function createBuildRoute<TRoutes extends RouteMap>() {
  return function buildRoute<TPath extends keyof TRoutes & string>(
    path: TPath,
    options?: BuildRouteOptions<TPath, RouteQuery<TRoutes, TPath>>,
  ): string {
    const finalPath = options?.params
      ? replacePathParams(path, options.params as PathParams<TPath>)
      : path;

    return appendQuery(finalPath, options?.query);
  };
}

export { createBuildRoute, rawPathParam };
export type {
  BuildRouteOptions,
  EmptyQuery,
  PathParams,
  QueryParams,
  QueryValue,
  RawPathParam,
  RouteDefinition,
  RouteMap,
};
