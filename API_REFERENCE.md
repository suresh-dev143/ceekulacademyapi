# API Reference for Front-end Developer

This document provides a summary of the most important API endpoints. For an interactive experience and complete specifications, please visit the Swagger UI at `/api-docs`.

## Base URL
- **Local**: `http://localhost:1003`
- **Production**: `https://ceekulmission.surajexpo.com`

## Authentication
Most protected routes require a Bearer Token.
`Authorization: Bearer <your_jwt_token>`

---

## User Endpoints

### Signup
- **URL**: `/users/signup`
- **Method**: `POST`
- **Body**:
  ```json
  {
    "name": "Full Name",
    "email": "user@example.com",
    "password": "StrongPassword123!",
    "number": "9876543210"
  }
  ```

### Login
- **URL**: `/users/login`
- **Method**: `POST`
- **Body**:
  ```json
  {
    "emailOrNumber": "user@example.com",
    "password": "StrongPassword123!"
  }
  ```

### Send OTP
- **URL**: `/users/sendOTP`
- **Method**: `POST`
- **Body**: `{ "number": "9876543210" }`

---

## Teacher & Course Management

### Create Course
- **URL**: `/api/teacher/courses`
- **Method**: `POST`
- **Auth**: Required
- **Body**:
  ```json
  {
    "title": "Course Title",
    "description": "Course Description",
    "category": "Technology",
    "price": 499
  }
  ```

### Get My Courses
- **URL**: `/api/teacher/courses`
- **Method**: `GET`
- **Auth**: Required

### Submit for Review
- **URL**: `/api/teacher/courses/:id/submit`
- **Method**: `POST`
- **Auth**: Required

---

## Public Course Discovery

### List Courses
- **URL**: `/api/courses`
- **Method**: `GET`
- **Query Params**: `page`, `limit`, `category`, `search`

### Featured Courses
- **URL**: `/api/courses/featured`
- **Method**: `GET`

### Course Details
- **URL**: `/api/courses/:idOrSlug`
- **Method**: `GET`

---

## Admin Endpoints

### Admin Login
- **URL**: `/admin/login`
- **Method**: `POST`
- **Body**: `{ "email": "admin@example.com", "password": "password" }`

### List Users
- **URL**: `/admin/users`
- **Method**: `GET`
- **Auth**: Admin Token Required
