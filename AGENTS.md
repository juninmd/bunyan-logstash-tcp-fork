```markdown
# AGENTS.md - AI Coding Agent Guidelines

These guidelines are designed to ensure the consistent, efficient, and reliable development of AGENTS.md, a repository for AI coding agents. Adherence to these principles is critical for maintaining code quality and minimizing unnecessary complexity.

**1. DRY (Don't Repeat Yourself)**

*   All functions, classes, and logic blocks should have single, well-defined responsibilities.
*   Avoid creating duplicate code.  When a piece of functionality is reused, make it a separate, specialized component.
*   When a component’s functionality is extended, create a new component rather than modifying the existing one.

**2. KISS (Keep It Simple, Stupid)**

*   Code should be as concise and easy to understand as possible.
*   Favor simple, declarative logic over complex, convoluted code.
*   Avoid unnecessary abstractions or layers of indirection.
*   Prioritize readability and maintainability over advanced features.

**3. SOLID Principles**

*   **Single Responsibility Principle:** Each class/module should have one, and only one, reason to change.
*   **Open/Closed Principle:**  The system should be extensible without modifying the core functionality.  (Focus on well-defined interfaces).
*   **Liskov Substitution Principle:**  Subclasses should be able to replace their base classes without breaking the correctness of the program.
*   **Interface Segregation Principle:** Clients should not be forced to depend on methods they do not use.
*   **Dependency Inversion Principle:**  High-level modules should be dependent on abstractions, not concrete implementations.

**4. YAGNI (You Aren’t Gonna Need It)**

*   Implement only the functionality that is absolutely required at the current point in time.
*   Avoid adding features that are unlikely to be used in the future.  Refactor and simplify as needed.
*   Focus on the immediate task at hand.

**5. Code Structure & Formatting**

*   **File Size Limit:** Each file must not exceed 180 lines of code.  Code must be properly indented and formatted.
*   **Naming Conventions:**
    *   Class names: Use PascalCase (e.g., `MyClass`).
    *   Function names: Use camelCase (e.g., `generate_response`).
    *   Variable names: Use snake_case (e.g., `input_data`).
*   **Comments:** Provide concise, clear, and helpful comments, but avoid over-commenting. Comments should explain *why* the code is written, not just *what* it does.
*   **Docstrings:**  Each class, function, and module should have a comprehensive docstring explaining its purpose, parameters, and return value.

**6.  Development Process**

*   **Pull Requests:** All code changes must be submitted as pull requests with thorough explanations and unit tests.
*   **Testing:**  Unit tests are *mandatory*. A minimum of 80% coverage is required for all functions and classes.  Test-driven development (TDD) should be considered.
*   **Version Control:**  Use Git with a robust branching strategy (e.g., Gitflow).
*   **Code Reviews:**  All code changes must undergo a formal code review process before merging.
*   **Documentation Updates:**  Documentation must be kept up-to-date.

**7.  Specific Guidelines**

*   **Data Structures:** Carefully consider data structure choices to minimize complexity and maintainability.
*   **Error Handling:** Implement robust error handling, including appropriate exception handling and logging.
*   **Logging:** Utilize logging strategically to track program behavior and debugging.
*   **Configuration Management:**  Use a consistent configuration management system to manage environment settings.
*   **API Design:** Strive for well-defined and documented APIs.

**8.  Testing Frameworks**

*   Utilize a testing framework (e.g., `pytest` or `unittest`) for automated testing.
*   Write unit tests to cover individual functions and classes.
*   Implement integration tests to verify interactions between different components.

**9.  Dependencies**

*   Minimize reliance on external dependencies.  Clearly document all dependencies.
*   Use versioning to manage dependencies effectively.
*   Consider alternative implementations of external libraries if feasible.

**10.  Maintainability**

*   Design the code with long-term maintainability in mind.
*   Use clear and consistent coding style.
*   Avoid complex or obscure code.
```