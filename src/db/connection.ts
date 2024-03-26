import { Options } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';

import config from './config/config';
import { User } from './models/User';

const env = process.env.NODE_ENV || 'development';
const sequelizeConfig = config[env];

let sequelize: Sequelize | null = null;

export async function connectToDatabase(): Promise<Sequelize> {
  if (!sequelize) {
    if (sequelizeConfig.use_env_variable) {
      // Handle the case where use_env_variable might be undefined
      sequelize = new Sequelize(process.env[sequelizeConfig.use_env_variable] || '', sequelizeConfig as Options);
    } else {
      sequelize = new Sequelize(
        {  
        dialect: sequelizeConfig.dialect,
        host: sequelizeConfig.host ,
        username: sequelizeConfig.username ,
        password: sequelizeConfig.password ,
        database: sequelizeConfig.database,
        logging: false,
        models: [User]
      }
      );
    }

    try {
      await sequelize.authenticate();
      console.log('Connection has been established successfully.');
    } catch (error) {
      console.error('Unable to connect to the database:', error);
      throw error;
    }
  }

  return sequelize;
}

export default sequelize;
