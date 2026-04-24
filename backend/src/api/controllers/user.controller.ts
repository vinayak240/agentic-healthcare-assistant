import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { CreateUserDto, LoginUserDto, UserIdParamDto } from '../dto';
import { UserService } from '../services';

@Controller('users')
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Post()
  createUser(@Body() body: CreateUserDto) {
    return this.userService.createUser(body);
  }

  @Post('login')
  loginUser(@Body() body: LoginUserDto) {
    return this.userService.loginUser(body.email);
  }

  @Get()
  listUsers() {
    return this.userService.listUsers();
  }

  @Get(':id')
  getUser(@Param() params: UserIdParamDto) {
    return this.userService.getUser(params.id);
  }
}
