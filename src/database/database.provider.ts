import { DataSource} from 'typeorm';

const DB_PORT = parseInt(process.env.DB_PORT);

let type;
switch (
  process.env.DB_TYPE //  add more cases here - maria, aurora?
) {
  case 'mysql':
    type = 'mysql';
    break;
  case 'postgres':
    type = 'postgres';
    break;
  default:
    type = 'mysql';
}

export const databaseProvider = [
  {
    provide: DataSource, // add the datasource as a provider
    inject: [],
    useFactory: async () => {
      // using the factory function to create the datasource instance
      try {
        const dataSource = new DataSource({
          type: type,
          host: process.env.DB_HOST,
          port: DB_PORT,
          username: process.env.DB_USER,
          password: process.env.DB_PASSWORD,
          database: process.env.DB_NAME,
          synchronize: true,
          // dropSchema: true,
          entities: [`${__dirname}/../api/**/entities/*.entity{.ts,.js}`], // target all .ts or .js files in the entities folder
        });

        await dataSource.initialize(); // initialize the data source
        console.log('Database connected successfully');
        return dataSource;
      } catch (error) {
        console.log('Error connecting to database');
        throw error;
      }
    },
  },
];
