def foo():
    return 1

def bar():
    return 2

def main():
    baz = 5
    return baz + foo() + bar()

if __name__ == '__main__':
    main()