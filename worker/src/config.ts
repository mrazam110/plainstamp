import generated from "./config.generated.json";
import { parseConfig } from "../../core/pipeline/config";

/** Region and topic data baked in at build time (npm run build:config from the YAML files). */
export const config = parseConfig(generated.regions, { topics: generated.topics });
