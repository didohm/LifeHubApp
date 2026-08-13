import RouteMap, { type RouteMapProps, type RoutePoint } from "./RouteMap";

export interface RouteMapGLProps extends RouteMapProps {}

/**
 * RouteMapGL re-exports the high-performance Strava-style RouteMap
 */
export default function RouteMapGL(props: RouteMapGLProps) {
  return <RouteMap {...props} />;
}
