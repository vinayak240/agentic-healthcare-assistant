import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { CreateUserDto, UserIdParamDto } from '../dto';
import { UserService } from '../services';

@Controller('users')
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Post()
  createUser(@Body() body: CreateUserDto) {
    return this.userService.createUser(body);
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
