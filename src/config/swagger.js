const swaggerJsdoc = require('swagger-jsdoc');

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'CeekulMission API',
      version: '1.0.0',
      description: 'API documentation for the CeekulMission platform',
      contact: {
        name: 'API Support',
        email: 'support@ceekulmission.com',
      },
    },
    servers: [
      {
        url: 'http://localhost:1003',
        description: 'Development server',
      },
      {
        url: 'https://ceekulmission.surajexpo.com',
        description: 'Production server',
      },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
        },
      },
    },
    security: [
      {
        bearerAuth: [],
      },
    ],
  },
  apis: [
    './src/routers/*.js', // Path to the API docs
    './src/models/*.js', // Path to models if annotations are added there
  ],
};

const specs = swaggerJsdoc(options);

module.exports = specs;
