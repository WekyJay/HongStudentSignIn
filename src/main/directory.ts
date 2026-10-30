import type { ClassRoster, SchoolClass } from '../shared/contracts'
import type { SchoolApiClient } from './school-api'

export interface StudentDirectory {
  readonly ready: boolean
  listClasses(): Promise<SchoolClass[]>
  fetchClassRoster(classId: string): Promise<ClassRoster>
}

// 未登录或数据源不可用时使用。没有数据源时绝不返回模拟成功。
export class UnconfiguredStudentDirectory implements StudentDirectory {
  readonly ready = false

  async listClasses(): Promise<SchoolClass[]> {
    throw new Error('学生信息接口尚未配置')
  }

  async fetchClassRoster(): Promise<ClassRoster> {
    throw new Error('学生信息接口尚未配置')
  }
}

export class SchoolServerDirectory implements StudentDirectory {
  constructor(private readonly api: SchoolApiClient) {}

  get ready(): boolean {
    return this.api.loggedIn
  }

  async listClasses(): Promise<SchoolClass[]> {
    return this.api.getClasses()
  }

  async fetchClassRoster(classId: string): Promise<ClassRoster> {
    return this.api.getStudents(classId)
  }
}
