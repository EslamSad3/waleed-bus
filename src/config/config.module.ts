import { Injectable, Module, Global } from '@nestjs/common';
import { AppConfig, loadConfig } from './configuration.js';

@Injectable()
export class ConfigService {
  readonly config: AppConfig;

  constructor() {
    this.config = loadConfig();
  }
}

@Global()
@Module({
  providers: [ConfigService],
  exports: [ConfigService],
})
export class ConfigModule {}
